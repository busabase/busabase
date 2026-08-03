"use client";

import { Button } from "kui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "kui/dialog";
import { Check } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { AvatarLogo } from "./avatar-logo";

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
  cropHint = "Drag to reposition, scroll to zoom in or out",
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
  const [isUploading, setIsUploading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isCropDialogOpen, setIsCropDialogOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.2);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalFileRef = useRef<File | null>(null);

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
      setZoom(1.2);
      setIsCropDialogOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

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

    // Set canvas size to cropped area
    canvas.width = croppedAreaPixels.width;
    canvas.height = croppedAreaPixels.height;

    // Draw cropped image
    ctx.drawImage(
      image,
      croppedAreaPixels.x,
      croppedAreaPixels.y,
      croppedAreaPixels.width,
      croppedAreaPixels.height,
      0,
      0,
      croppedAreaPixels.width,
      croppedAreaPixels.height,
    );

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
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </div>
          <p className="text-xs text-center text-muted-foreground">{cropHint}</p>
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
