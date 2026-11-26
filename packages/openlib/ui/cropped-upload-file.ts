const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** File name whose extension matches the cropped blob, so storage keys agree with the bytes. */
export const croppedUploadFileName = (originalName: string, mimeType: string): string => {
  const extension = EXTENSION_BY_MIME[mimeType];
  if (!extension) return originalName;
  const base = originalName.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${extension}`;
};

/** Preserve cropped bytes and MIME type when handing them to an app's uploader. */
export const createCroppedUploadFile = (originalFile: File, croppedBlob: Blob): File => {
  const mimeType = croppedBlob.type || "image/jpeg";
  return new File([croppedBlob], croppedUploadFileName(originalFile.name, mimeType), {
    type: mimeType,
  });
};
