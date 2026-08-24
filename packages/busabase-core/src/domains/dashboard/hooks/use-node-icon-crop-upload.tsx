"use client";

// Encapsulates the "pick image → crop → upload" pipeline for a node's custom
// avatar — mirrors buda's `useLogoCropUpload`
// (`apps/buda/src/domains/agent-controller/components/use-logo-crop-upload.tsx`)
// almost line-for-line, with the upload target swapped from buda's
// `useAvatarUpload` (its own S3 route) to the `nodes.icon.createUploadUrl` /
// `nodes.icon.confirm` oRPC pair (see `attachments-logic.ts`'s
// `requestNodeIconUploadUrl`/`confirmNodeIconUpload`), which is what actually
// keeps a node icon out of the Assets library and disjoint from any other
// node's icon (see that file's doc comment for the dedup-scope reasoning).
//
// Storage model: same as buda — a fresh upload persists BOTH the original
// (uncropped) and the cropped display version, plus the crop UI state, into
// the `NodeIcon` jsonb, so re-opening the crop dialog can non-destructively
// re-crop against the untouched source image.

import { useMutation } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeIcon } from "busabase-contract/types";
import { Button } from "kui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "kui/dialog";
import { Slider } from "kui/slider";
import { ImageUp, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { toast } from "sonner";
import { useCoreI18n } from "../../../i18n";

interface UseNodeIconCropUploadOptions {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  onUpload: (icon: NodeIcon) => void;
}

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function useNodeIconCropUpload({ orpc, nodeId, onUpload }: UseNodeIconCropUploadOptions) {
  const messages = useCoreI18n();
  const t = messages.nodeSettings;

  const createUploadUrl = useMutation(orpc.nodes.icon.createUploadUrl.mutationOptions());
  const confirmUpload = useMutation(orpc.nodes.icon.confirm.mutationOptions());

  // Pushes bytes to wherever `createUploadUrl` pointed — a presigned S3/R2 PUT
  // in production, or the local-dev relay (a plain POST carrying the key),
  // same dev-vs-prod branch `useAttachmentUpload` uses for asset uploads.
  const uploadFile = useCallback(
    async (file: File): Promise<{ url: string; attachmentId: string }> => {
      const requested = await createUploadUrl.mutateAsync({
        nodeId,
        fileName: file.name,
        mimeType: file.type || "image/png",
        sizeBytes: file.size,
      });
      if (requested.duplicate && requested.attachmentId) {
        return { url: requested.publicUrl, attachmentId: requested.attachmentId };
      }
      if (requested.uploadUrl.startsWith("/")) {
        const form = new FormData();
        form.append("file", file);
        form.append("storageKey", requested.storageKey);
        const response = await fetch(requested.uploadUrl, { method: "POST", body: form });
        if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      } else {
        const response = await fetch(requested.uploadUrl, {
          body: file,
          headers: { "content-type": file.type || "application/octet-stream" },
          method: "PUT",
        });
        if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      }
      const confirmed = await confirmUpload.mutateAsync({
        nodeId,
        storageKey: requested.storageKey,
        fileName: file.name,
        mimeType: file.type || "image/png",
        sizeBytes: file.size,
      });
      return { url: confirmed.publicUrl, attachmentId: confirmed.attachmentId };
    },
    [createUploadUrl, confirmUpload, nodeId],
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalFileRef = useRef<File | null>(null);
  // When re-cropping an already-saved icon, reuse the existing original
  // attachment instead of re-uploading the source image.
  const reusedOriginalRef = useRef<{ url: string; attachmentId: string } | null>(null);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingPreview, setUploadingPreview] = useState<string | null>(null);

  const onCropComplete = useCallback((_: Area, area: Area) => {
    setCroppedAreaPixels(area);
  }, []);

  const resetState = () => {
    setSelectedImage(null);
    originalFileRef.current = null;
    reusedOriginalRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t.iconFileMustBeImage);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(t.iconFileTooLarge);
      return;
    }
    originalFileRef.current = file;
    reusedOriginalRef.current = null;
    const reader = new FileReader();
    reader.onload = () => {
      setSelectedImage(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setIsCropOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const openWithIcon = (icon: NodeIcon) => {
    if (icon.type !== "attachment") return;
    const sourceUrl = icon.originalUrl ?? icon.url;
    const sourceAttachmentId = icon.originalAttachmentId ?? icon.attachmentId;
    reusedOriginalRef.current = { url: sourceUrl, attachmentId: sourceAttachmentId };
    originalFileRef.current = null;
    setSelectedImage(sourceUrl);
    setCrop(icon.crop ? { x: icon.crop.x, y: icon.crop.y } : { x: 0, y: 0 });
    setZoom(icon.crop?.zoom ?? 1);
    setIsCropOpen(true);
  };

  /** Opens the crop dialog empty — the user picks a file via its own button. */
  const openEmpty = () => {
    reusedOriginalRef.current = null;
    originalFileRef.current = null;
    setSelectedImage(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setIsCropOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const createCroppedBlob = async (): Promise<Blob> => {
    if (!selectedImage || !croppedAreaPixels) throw new Error("No image selected");
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = selectedImage;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");
    canvas.width = croppedAreaPixels.width;
    canvas.height = croppedAreaPixels.height;
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
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Failed to create blob"))),
        "image/jpeg",
        0.95,
      );
    });
  };

  const handleConfirmCrop = async () => {
    setIsUploading(true);
    setIsCropOpen(false);
    let previewUrl: string | null = null;
    try {
      const cropBlob = await createCroppedBlob();
      previewUrl = URL.createObjectURL(cropBlob);
      setUploadingPreview(previewUrl);

      let original: { url: string; attachmentId: string };
      if (reusedOriginalRef.current) {
        original = reusedOriginalRef.current;
      } else if (originalFileRef.current) {
        const file = originalFileRef.current;
        original = await uploadFile(file);
      } else {
        throw new Error("No source image available");
      }

      const croppedFile = new File([cropBlob], "node-icon-cropped.jpg", { type: "image/jpeg" });
      const croppedUpload = await uploadFile(croppedFile);

      onUpload({
        type: "attachment",
        url: croppedUpload.url,
        attachmentId: croppedUpload.attachmentId,
        originalUrl: original.url,
        originalAttachmentId: original.attachmentId,
        crop: { x: crop.x, y: crop.y, zoom },
      });
      toast.success(t.iconUpdated);
    } catch (err) {
      console.error(err);
      toast.error(t.iconUploadFailed);
    } finally {
      setIsUploading(false);
      setUploadingPreview(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      resetState();
    }
  };

  const handleCancelCrop = () => {
    setIsCropOpen(false);
    resetState();
  };

  const trigger = () => fileInputRef.current?.click();

  const dialog = (
    <>
      <input
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
        ref={fileInputRef}
        type="file"
      />

      <Dialog onOpenChange={setIsCropOpen} open={isCropOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[440px]">
          <DialogHeader className="border-b px-5 py-3.5">
            <DialogTitle className="font-semibold text-sm">{t.cropDialogTitle}</DialogTitle>
          </DialogHeader>

          <div className="bg-muted/30 px-6 pt-6 pb-4">
            <div className="relative mx-auto aspect-square w-full max-w-[340px] overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-800">
              {selectedImage ? (
                <Cropper
                  aspect={1}
                  crop={crop}
                  cropShape="round"
                  image={selectedImage}
                  onCropChange={setCrop}
                  onCropComplete={onCropComplete}
                  onZoomChange={setZoom}
                  showGrid={false}
                  style={{
                    cropAreaStyle: {
                      border: "2px solid rgba(255,255,255,0.9)",
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                      color: "rgba(0,0,0,0.55)",
                    },
                  }}
                  zoom={zoom}
                />
              ) : (
                <button
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <span className="flex size-14 items-center justify-center rounded-full bg-background/60 text-foreground">
                    <ImageUp className="h-6 w-6" />
                  </span>
                  <p className="font-medium text-sm">{t.iconUploadLabel}</p>
                  <p className="text-[11px]">{t.iconUploadFormatHint}</p>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 border-t bg-background px-6 py-3">
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
              disabled={zoom <= 1}
              onClick={() => setZoom((z) => Math.max(1, +(z - 0.2).toFixed(2)))}
              type="button"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <Slider
              className="flex-1"
              max={3}
              min={1}
              onValueChange={(v) => setZoom(v[0] ?? 1)}
              step={0.05}
              value={[zoom]}
            />
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
              disabled={zoom >= 3}
              onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}
              type="button"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>

          <DialogFooter className="border-t bg-background px-5 py-3 sm:justify-between sm:gap-2">
            <Button onClick={() => fileInputRef.current?.click()} size="sm" variant="outline">
              <ImageUp className="mr-1.5 h-3.5 w-3.5" />
              {t.iconUploadLabel}
            </Button>
            <div className="flex items-center gap-2">
              <Button onClick={handleCancelCrop} size="sm" variant="outline">
                {messages.common.cancel}
              </Button>
              <Button disabled={!selectedImage} onClick={handleConfirmCrop} size="sm">
                {t.confirmCrop}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { trigger, openWithIcon, openEmpty, dialog, isUploading, uploadingPreview };
}
