import { describe, expect, it } from "vitest";
import { createCroppedUploadFile, croppedUploadFileName } from "./cropped-upload-file";

describe("croppedUploadFileName", () => {
  it("names a PNG logo crop as png even when the original file was a jpeg", () => {
    expect(croppedUploadFileName("logo.jpg", "image/png")).toBe("logo.png");
  });

  it("names a jpeg crop as jpg", () => {
    expect(croppedUploadFileName("avatar.png", "image/jpeg")).toBe("avatar.jpg");
  });

  it("keeps the original name when the type is not an image we rename", () => {
    expect(croppedUploadFileName("scan.tiff", "image/tiff")).toBe("scan.tiff");
  });
});

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

describe("createCroppedUploadFile", () => {
  it("keeps PNG bytes and the MIME/name contract even for a JPEG original", async () => {
    const file = createCroppedUploadFile(
      new File([jpegBytes], "logo.original.jpg", { type: "image/jpeg" }),
      new Blob([pngBytes], { type: "image/png" }),
    );
    expect(file.name).toBe("logo.original.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pngBytes);
  });

  it("keeps JPEG bytes and labels them as JPEG regardless of the source extension", async () => {
    const file = createCroppedUploadFile(
      new File([pngBytes], "avatar.png", { type: "image/png" }),
      new Blob([jpegBytes], { type: "image/jpeg" }),
    );
    expect(file.name).toBe("avatar.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(jpegBytes);
  });

  it("retains the existing JPEG fallback for a blob without a MIME type", () => {
    const file = createCroppedUploadFile(new File([], "avatar"), new Blob([jpegBytes]));
    expect(file.name).toBe("avatar.jpg");
    expect(file.type).toBe("image/jpeg");
  });
});
