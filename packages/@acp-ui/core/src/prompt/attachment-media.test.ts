import { describe, expect, it } from "vitest";
import {
  attachmentText,
  attachmentToContentBlock,
  attachmentUri,
  classifyMimeType,
  decodeBase64,
  decodeUtf8Text,
} from "./attachment-media";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const bytesB64 = (...bytes: number[]) => Buffer.from(bytes).toString("base64");

describe("classifyMimeType", () => {
  it("recognises text/* and the textual application/* types", () => {
    for (const type of [
      "text/plain",
      "text/markdown",
      "text/csv",
      "TEXT/HTML",
      "text/plain; charset=utf-8",
      "application/json",
      "application/yaml",
      "application/x-sh",
      "application/vnd.api+json",
      "image/svg+xml",
    ]) {
      expect(classifyMimeType(type), type).not.toBe(false);
    }
    expect(classifyMimeType("application/json")).toBe(true);
    expect(classifyMimeType("application/vnd.api+json")).toBe(true);
  });

  it("recognises the obviously binary families", () => {
    expect(classifyMimeType("image/png")).toBe(false);
    expect(classifyMimeType("audio/wav")).toBe(false);
    expect(classifyMimeType("video/mp4")).toBe(false);
    expect(classifyMimeType("application/pdf")).toBe(false);
    expect(classifyMimeType("application/zip")).toBe(false);
  });

  it("stays undecided where the browser is unreliable", () => {
    // Browsers report "" for extensions they don't know, and `video/mp2t`
    // for `.ts` — deferring to byte sniffing is the whole point.
    expect(classifyMimeType("")).toBeUndefined();
    expect(classifyMimeType("   ")).toBeUndefined();
    expect(classifyMimeType("video/mp2t")).toBeUndefined();
    expect(classifyMimeType("application/octet-stream")).toBeUndefined();
  });
});

describe("decodeBase64 / decodeUtf8Text", () => {
  it("round-trips UTF-8, including multi-byte characters", () => {
    const bytes = decodeBase64(b64("héllo 世界"));
    expect(bytes).not.toBeNull();
    expect(decodeUtf8Text(bytes as Uint8Array)).toBe("héllo 世界");
  });

  it("returns null for input that is not base64 at all", () => {
    expect(decodeBase64("not base64!!!")).toBeNull();
  });

  it("rejects a NUL byte even though it is valid UTF-8", () => {
    expect(decodeUtf8Text(new Uint8Array([0x68, 0x00, 0x69]))).toBeNull();
  });

  it("rejects invalid UTF-8 rather than returning replacement characters", () => {
    // 0xFF is never valid in UTF-8. A lenient decoder would hand back "�",
    // which reads as plausible text and is exactly the bug this guards.
    expect(decodeUtf8Text(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
  });
});

describe("attachmentText", () => {
  it("returns the decoded text for a textual payload", () => {
    expect(attachmentText("text/markdown", b64("# hi"))).toBe("# hi");
  });

  it("returns null for a declared-binary type without even decoding", () => {
    expect(attachmentText("application/pdf", b64("this is actually text"))).toBeNull();
  });

  it("sniffs an unknown type by its bytes", () => {
    expect(attachmentText("", b64("plain words"))).toBe("plain words");
    expect(attachmentText("", bytesB64(0xff, 0xd8, 0xff, 0xe0))).toBeNull();
  });

  it("treats empty content as text only when the MIME type is confident", () => {
    expect(attachmentText("text/plain", "")).toBe("");
    expect(attachmentText("", "")).toBeNull();
  });
});

describe("attachmentUri", () => {
  it("percent-encodes the filename under an opaque scheme", () => {
    expect(attachmentUri("my report.pdf")).toBe("attachment:///my%20report.pdf");
    expect(attachmentUri("报告.pdf")).toBe("attachment:///%E6%8A%A5%E5%91%8A.pdf");
  });

  it("falls back to a stable label when there is no filename", () => {
    expect(attachmentUri(undefined)).toBe("attachment:///attachment");
    expect(attachmentUri("   ")).toBe("attachment:///attachment");
  });
});

describe("attachmentToContentBlock", () => {
  it("passes image and audio through unchanged", () => {
    expect(
      attachmentToContentBlock({ kind: "image", data: "aW1n", mimeType: "image/png" }),
    ).toEqual({ type: "image", data: "aW1n", mimeType: "image/png" });
  });

  it("builds a text resource for text and a blob resource for bytes", () => {
    expect(
      attachmentToContentBlock({
        kind: "file",
        data: b64("hi"),
        mimeType: "text/plain",
        filename: "a.txt",
      }),
    ).toEqual({
      type: "resource",
      resource: { uri: "attachment:///a.txt", mimeType: "text/plain", text: "hi" },
    });

    const blob = bytesB64(0x00, 0x01, 0x02);
    expect(
      attachmentToContentBlock({
        kind: "file",
        data: blob,
        mimeType: "application/pdf",
        filename: "a.pdf",
      }),
    ).toEqual({
      type: "resource",
      resource: { uri: "attachment:///a.pdf", mimeType: "application/pdf", blob },
    });
  });
});
