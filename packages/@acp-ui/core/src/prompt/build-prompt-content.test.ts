import { describe, expect, it } from "vitest";
import type { AcpAttachment } from "../reduce";
import { buildPromptContent } from "./build-prompt-content";

describe("buildPromptContent", () => {
  it("wraps bare text as a single text block when there are no attachments", () => {
    expect(buildPromptContent("hello", undefined)).toEqual([{ type: "text", text: "hello" }]);
    expect(buildPromptContent("hello", [])).toEqual([{ type: "text", text: "hello" }]);
  });

  it("appends image and audio attachments after the text block, in order", () => {
    const attachments: AcpAttachment[] = [
      { kind: "image", data: "aW1n", mimeType: "image/png" },
      { kind: "audio", data: "YXVk", mimeType: "audio/wav" },
    ];

    expect(buildPromptContent("caption", attachments)).toEqual([
      { type: "text", text: "caption" },
      { type: "image", data: "aW1n", mimeType: "image/png" },
      { type: "audio", data: "YXVk", mimeType: "audio/wav" },
    ]);
  });

  it("allows an empty text with attachments (caption-less send)", () => {
    const attachments: AcpAttachment[] = [{ kind: "image", data: "aW1n", mimeType: "image/png" }];

    expect(buildPromptContent("", attachments)).toEqual([
      { type: "text", text: "" },
      { type: "image", data: "aW1n", mimeType: "image/png" },
    ]);
  });
});
