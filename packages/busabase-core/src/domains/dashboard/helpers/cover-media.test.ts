import { describe, expect, it } from "vitest";
import { pickCoverMedia, toVideoCoverSrc } from "./cover-media";

const ref = (fileName: string, mimeType: string, url = `https://example.com/${fileName}`) => ({
  id: fileName,
  url,
  fileName,
  mimeType,
  size: 1,
});

describe("pickCoverMedia", () => {
  it("returns null for cells with nothing drawable", () => {
    expect(pickCoverMedia(undefined)).toBeNull();
    expect(pickCoverMedia([])).toBeNull();
    expect(pickCoverMedia([ref("brief.pdf", "application/pdf")])).toBeNull();
  });

  it("uses the first image, even when a video comes first", () => {
    expect(
      pickCoverMedia([
        ref("clip.mp4", "video/mp4"),
        ref("poster.png", "image/png"),
        ref("other.jpg", "image/jpeg"),
      ]),
    ).toEqual({ kind: "image", url: "https://example.com/poster.png", fileName: "poster.png" });
  });

  it("falls back to the first video when there is no image", () => {
    expect(
      pickCoverMedia([
        ref("brief.pdf", "application/pdf"),
        ref("first.webm", "video/webm"),
        ref("second.mp4", "video/mp4"),
      ]),
    ).toEqual({ kind: "video", url: "https://example.com/first.webm", fileName: "first.webm" });
  });

  it("skips media whose URL is not safe to fetch", () => {
    expect(
      pickCoverMedia([
        ref("evil.png", "image/png", "javascript:alert(1)"),
        ref("clip.mp4", "video/mp4"),
      ]),
    ).toEqual({ kind: "video", url: "https://example.com/clip.mp4", fileName: "clip.mp4" });
  });
});

describe("toVideoCoverSrc", () => {
  it("asks for a frame just past the start", () => {
    expect(toVideoCoverSrc("https://example.com/clip.mp4")).toBe(
      "https://example.com/clip.mp4#t=0.1",
    );
  });

  it("leaves a URL that already has a fragment alone", () => {
    expect(toVideoCoverSrc("https://example.com/clip.mp4#t=3")).toBe(
      "https://example.com/clip.mp4#t=3",
    );
  });
});
