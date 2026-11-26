"use client";

import { Button } from "kui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "kui/dialog";
import { Slider } from "kui/slider";
import { Check } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import Cropper, { type Area, type MediaSize, type Size } from "react-easy-crop";
import { AvatarLogo } from "./avatar-logo";
import {
  type CropPoint,
  clampCropPoint,
  INITIAL_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoomFromWheel,
  placeCropOnImage,
} from "./crop-frame";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

interface AvatarUploadProps {
  currentAvatar?: string | null;
  fallback: string;
  /** Alt text for the preview image */
  alt?: string;
  onUploadComplete: (file: File, croppedBlob: Blob) => Promise<void>;
  onRemove?: () => void;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Blocks picking/removing while the host is busy with something else. */
  disabled?: boolean;
  uploadLabel?: string;
  removeLabel?: string;
  cropLabel?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  /** Hint text shown below the crop area to guide users */
  cropHint?: string;
  /**
   * Cover keeps the existing avatar interaction. Logo enables gentle wheel
   * zoom, a slider, and repositioning that can leave transparent padding.
   */
  cropMode?: "cover" | "logo";
  /** Accessible name for the zoom slider */
  zoomLabel?: string;
  /** Hint text shown next to the buttons, describing accepted files */
  fileHint?: string;
  /** Largest accepted original file, in bytes. Defaults to 10MB. */
  maxBytes?: number;
  /**
   * Format of the cropped blob. JPEG (the default) is smaller, but it has no
   * alpha channel — a logo with a transparent background would come back with
   * the canvas' black behind it, so hosts cropping logos pass `"image/png"`.
   */
  outputMimeType?: "image/jpeg" | "image/png";
  /** Shown when the picked file isn't an image */
  invalidTypeMessage?: string;
  /** Shown when the picked file is larger than `maxBytes` */
  tooLargeMessage?: string;
  /** Shown when `onUploadComplete` rejects */
  uploadFailedMessage?: string;
  /** Passed to `onUploadSuccess` once `onUploadComplete` resolves */
  uploadSuccessMessage?: string;
  /**
   * Where problems get surfaced. Hosts that have a toaster pass
   * `(message) => toast.error(message)`; when omitted the message is rendered
   * inline underneath the buttons so it is never silently swallowed.
   */
  onError?: (message: string) => void;
  /** Optional success notification hook, e.g. `(m) => toast.success(m)`. */
  onUploadSuccess?: (message: string) => void;
}

/**
 * Avatar upload component with image cropping
 * - File selection with validation
 * - Image cropping with zoom/pan
 * - Preview before upload
 * - Integrates with S3 upload workflow
 *
 * Deliberately free of any toast dependency: `openlib` is consumed by
 * open-source apps that don't necessarily mount a `<Toaster />`, and a toast
 * fired into a page with no toaster disappears without a trace. Errors are
 * therefore reported through `onError` (or rendered inline when it's absent).
 */
export function AvatarUpload({
  currentAvatar,
  fallback,
  alt,
  onUploadComplete,
  onRemove,
  size = "lg",
  disabled = false,
  uploadLabel = "Upload",
  removeLabel = "Remove",
  cropLabel = "Crop Image",
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  cropHint,
  cropMode = "cover",
  zoomLabel = "Zoom",
  fileHint = "JPG, PNG or GIF. Max 10MB. Recommended size: 400x400px for best quality across all devices.",
  maxBytes = DEFAULT_MAX_BYTES,
  outputMimeType = "image/jpeg",
  invalidTypeMessage = "Please select an image file",
  tooLargeMessage = "Image size must be less than 10MB",
  uploadFailedMessage = "Failed to upload avatar",
  uploadSuccessMessage = "Avatar uploaded successfully",
  onError,
  onUploadSuccess,
}: AvatarUploadProps) {
  const allowsPadding = cropMode === "logo";
  const resolvedCropHint =
    cropHint ??
    (allowsPadding
      ? "Drag to reposition. Scroll or use the slider to zoom."
      : "Drag to reposition, scroll to zoom in or out");
  const [isUploading, setIsUploading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropPoint>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalFileRef = useRef<File | null>(null);
  const zoomRef = useRef(INITIAL_ZOOM);
  const mediaSizeRef = useRef<Size | null>(null);
  const cropSizeRef = useRef<Size | null>(null);
  zoomRef.current = zoom;

  const reportError = (message: string) => {
    if (onError) onError(message);
    else setInlineError(message);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setInlineError(null);

    // Validate file type
    if (!file.type.startsWith("image/")) {
      reportError(invalidTypeMessage);
      return;
    }

    // Validate file size
    if (file.size > maxBytes) {
      reportError(tooLargeMessage);
      return;
    }

    // Store original file
    originalFileRef.current = file;

    // Create preview URL
    const reader = new FileReader();
    reader.onload = () => {
      setSelectedImage(reader.result as string);
      setCrop({ x: 0, y: 0 });
      zoomRef.current = INITIAL_ZOOM;
      setZoom(INITIAL_ZOOM);
      mediaSizeRef.current = null;
      cropSizeRef.current = null;
      setIsCropDialogOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  // The cropper calls this with the raw drag. Clamp here, because its built-in
  // restrictPosition drops the gesture once the image is zoomed out to the frame.
  const handleCropChange = (next: CropPoint) => {
    const media = mediaSizeRef.current;
    const frame = cropSizeRef.current;
    const resolved =
      allowsPadding && media && frame ? clampCropPoint(next, media, frame, zoomRef.current) : next;
    setCrop((current) =>
      current.x === resolved.x && current.y === resolved.y ? current : resolved,
    );
  };

  const handleZoomChange = (next: number) => {
    const resolved = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    zoomRef.current = resolved;
    setZoom((current) => (current === resolved ? current : resolved));
    const media = mediaSizeRef.current;
    const frame = cropSizeRef.current;
    if (allowsPadding && media && frame) {
      setCrop((current) => clampCropPoint(current, media, frame, resolved));
    }
  };

  const handleWheelZoom = (event: WheelEvent) => {
    event.preventDefault();
    handleZoomChange(nextZoomFromWheel(zoomRef.current, event.deltaY, event.deltaMode));
    return false;
  };

  const createCroppedImage = async (): Promise<Blob> => {
    if (!selectedImage || !croppedAreaPixels) {
      throw new Error("No image selected");
    }

    const image = new Image();
    image.src = selectedImage;
    await new Promise((resolve) => {
      image.onload = resolve;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");

    const cropWidth = Math.max(1, Math.round(croppedAreaPixels.width));
    const cropHeight = Math.max(1, Math.round(croppedAreaPixels.height));
    canvas.width = cropWidth;
    canvas.height = cropHeight;

    // JPEG has no alpha. Padding from a zoomed-out, repositioned logo would
    // otherwise be black; PNG keeps that padding transparent.
    if (allowsPadding && outputMimeType === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cropWidth, cropHeight);
    } else {
      ctx.clearRect(0, 0, cropWidth, cropHeight);
    }

    const placement = placeCropOnImage(croppedAreaPixels, {
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    if (placement) {
      const scaleX = cropWidth / croppedAreaPixels.width;
      const scaleY = cropHeight / croppedAreaPixels.height;
      ctx.drawImage(
        image,
        placement.source.x,
        placement.source.y,
        placement.source.width,
        placement.source.height,
        placement.destination.x * scaleX,
        placement.destination.y * scaleY,
        placement.destination.width * scaleX,
        placement.destination.height * scaleY,
      );
    }

    // Convert to blob
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to create blob"));
        },
        outputMimeType,
        0.95,
      );
    });
  };

  const handleConfirmCrop = async () => {
    if (!originalFileRef.current) return;

    setIsUploading(true);
    setIsCropDialogOpen(false);

    try {
      const croppedBlob = await createCroppedImage();
      await onUploadComplete(originalFileRef.current, croppedBlob);
      onUploadSuccess?.(uploadSuccessMessage);
    } catch (error) {
      console.error("Upload error:", error);
      reportError(uploadFailedMessage);
    } finally {
      setIsUploading(false);
      setSelectedImage(null);
      originalFileRef.current = null;
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleCancelCrop = () => {
    setIsCropDialogOpen(false);
    setSelectedImage(null);
    originalFileRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemove = () => {
    onRemove?.();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <AvatarLogo
          src={currentAvatar}
          fallback={fallback}
          {...(alt ? { alt } : {})}
          size={size}
          editable
          loading={isUploading}
          onUploadClick={() => {
            if (!disabled) fileInputRef.current?.click();
          }}
        />

        <div className="flex flex-col gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || disabled}
            >
              {uploadLabel}
            </Button>
            {currentAvatar && onRemove && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRemove}
                disabled={isUploading || disabled}
                className="text-destructive hover:text-destructive"
              >
                {removeLabel}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{fileHint}</p>
          {inlineError ? <p className="text-xs text-destructive">{inlineError}</p> : null}
        </div>
      </div>

      {/* Crop Dialog */}
      <Dialog open={isCropDialogOpen} onOpenChange={setIsCropDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{cropLabel}</DialogTitle>
          </DialogHeader>
          <div className="relative h-[400px] bg-muted">
            {selectedImage && (
              <Cropper
                image={selectedImage}
                crop={crop}
                zoom={zoom}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                aspect={1}
                cropShape="round"
                showGrid={false}
                restrictPosition={!allowsPadding}
                onWheelRequest={allowsPadding ? handleWheelZoom : undefined}
                onCropChange={handleCropChange}
                onZoomChange={handleZoomChange}
                onCropComplete={onCropComplete}
                setMediaSize={(size: MediaSize) => {
                  mediaSizeRef.current = { width: size.width, height: size.height };
                }}
                setCropSize={(size: Size) => {
                  cropSizeRef.current = size;
                }}
              />
            )}
          </div>
          {allowsPadding ? (
            <Slider
              aria-label={zoomLabel}
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={[zoom]}
              onValueChange={(value) => {
                const next = value[0];
                if (next !== undefined) handleZoomChange(next);
              }}
            />
          ) : null}
          <p className="text-xs text-center text-muted-foreground">{resolvedCropHint}</p>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelCrop}>
              {cancelLabel}
            </Button>
            <Button onClick={handleConfirmCrop}>
              <Check className="h-4 w-4 mr-2" />
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
