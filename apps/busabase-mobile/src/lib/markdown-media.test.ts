import { describe, expect, it } from "vitest";
import { markdownMediaFor } from "./markdown-media";

const SERVER = "http://192.168.1.20:15419";

describe("markdownMediaFor", () => {
  it("resolves a self-hosted relative image against the connected server", () => {
    // The library's own fallback would have produced `https:///api/storage/...`.
    expect(markdownMediaFor("/api/storage/attachments/a.png", SERVER)).toEqual({
      kind: "image",
      uri: `${SERVER}/api/storage/attachments/a.png`,
    });
  });

  it("leaves an absolute image alone", () => {
    expect(markdownMediaFor("https://cdn.example.com/a.png", SERVER).uri).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  it("treats a video carried as an image as a video, resolved the same way", () => {
    expect(markdownMediaFor("/api/storage/demo/walkthrough.mp4", SERVER)).toEqual({
      kind: "video",
      uri: `${SERVER}/api/storage/demo/walkthrough.mp4`,
    });
  });

  it("does not call a javascript: source a video", () => {
    // Web's rule, reused: only http(s) or relative sources are playable.
    expect(markdownMediaFor("javascript:alert(1)//.mp4", SERVER).kind).toBe("image");
  });
});
