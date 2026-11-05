import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_FILE_SIZE,
  computeMultipartPartSize,
  countMultipartParts,
  createFileTooLargeClientError,
  formatFileSize,
  getFileTooLargeErrorData,
  MULTIPART_MAX_PARTS,
  MULTIPART_MIN_PART_SIZE,
  resolveEffectiveMaxFileSize,
  shouldUseMultipartUpload,
} from "./file-size";

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe("attachment size limits", () => {
  it("caps every upload at 5GB", () => {
    expect(ATTACHMENT_MAX_FILE_SIZE).toBe(5 * GB);
  });

  it("lets the tightest limit win and never loosens the ceiling", () => {
    // A field's own limit below the plan limit wins.
    expect(resolveEffectiveMaxFileSize(10 * MB, 2 * MB)).toBe(2 * MB);
    // A field limit ABOVE the plan limit cannot loosen the plan limit.
    expect(resolveEffectiveMaxFileSize(10 * MB, 50 * MB)).toBe(10 * MB);
    // Nothing loosens the 5GB ceiling.
    expect(resolveEffectiveMaxFileSize(10 * GB)).toBe(5 * GB);
    expect(resolveEffectiveMaxFileSize(undefined, null, 0, -1)).toBe(5 * GB);
  });

  it("formats limits the way users read them", () => {
    expect(formatFileSize(10 * MB)).toBe("10 MB");
    expect(formatFileSize(5 * GB)).toBe("5 GB");
    expect(formatFileSize(1.5 * GB)).toBe("1.5 GB");
    expect(formatFileSize(512 * 1024)).toBe("512 KB");
    expect(formatFileSize(12)).toBe("12 B");
  });
});

describe("multipart sizing", () => {
  it("uses multipart only above the threshold", () => {
    expect(shouldUseMultipartUpload(64 * MB)).toBe(false);
    expect(shouldUseMultipartUpload(64 * MB + 1)).toBe(true);
  });

  it.each([65 * MB, 1 * GB, 5 * GB])(
    "plans uniform parts within S3/R2 limits for %d bytes",
    (size) => {
      const partSize = computeMultipartPartSize(size);
      const partCount = countMultipartParts(size, partSize);
      expect(partSize).toBeGreaterThanOrEqual(MULTIPART_MIN_PART_SIZE);
      // Comfortably below the smallest host relay body cap (100mb).
      expect(partSize).toBeLessThanOrEqual(64 * MB);
      expect(partCount).toBeLessThanOrEqual(MULTIPART_MAX_PARTS);
      expect(partSize * (partCount - 1)).toBeLessThan(size);
      expect(partSize * partCount).toBeGreaterThanOrEqual(size);
    },
  );
});

describe("structured file-too-large errors", () => {
  it("round-trips through the client error and ignores unrelated errors", () => {
    const error = createFileTooLargeClientError({
      limit: 10 * MB,
      sizeBytes: 11 * MB,
      fileName: "a.mov",
    });
    expect(error.message).toBe("File size exceeds the maximum allowed size of 10 MB");
    expect(getFileTooLargeErrorData(error)).toEqual({
      code: "FILE_TOO_LARGE",
      limit: 10 * MB,
      sizeBytes: 11 * MB,
      fileName: "a.mov",
    });
    expect(getFileTooLargeErrorData(new Error("nope"))).toBeNull();
    expect(getFileTooLargeErrorData({ data: { code: "USAGE_LIMIT_EXCEEDED" } })).toBeNull();
  });

  it("reads the upgrade target from a wire error's data", () => {
    expect(
      getFileTooLargeErrorData({
        data: { code: "FILE_TOO_LARGE", limit: 10 * MB, upgradeLimit: 5 * GB },
      }),
    ).toEqual({ code: "FILE_TOO_LARGE", limit: 10 * MB, upgradeLimit: 5 * GB });
  });
});
