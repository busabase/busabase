import { describe, expect, it } from "vitest";
import type { AcpAttachment } from "../reduce";
import { buildPromptContent } from "./build-prompt-content";

/** base64 of a UTF-8 string — the shape the browser always sends. */
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

describe("buildPromptContent", () => {
  it("wraps bare text as a single text block when there are no attachments", () => {
    expect(buildPromptContent("hello", undefined)).toEqual({
      prompt: [{ type: "text", text: "hello" }],
      notes: [],
    });
    expect(buildPromptContent("hello", [])).toEqual({
      prompt: [{ type: "text", text: "hello" }],
      notes: [],
    });
  });

  it("appends image and audio attachments after the text block, in order", () => {
    const attachments: AcpAttachment[] = [
      { kind: "image", data: "aW1n", mimeType: "image/png" },
      { kind: "audio", data: "YXVk", mimeType: "audio/wav" },
    ];

    expect(buildPromptContent("caption", attachments)).toEqual({
      prompt: [
        { type: "text", text: "caption" },
        { type: "image", data: "aW1n", mimeType: "image/png" },
        { type: "audio", data: "YXVk", mimeType: "audio/wav" },
      ],
      notes: [],
    });
  });

  it("allows an empty text with attachments (caption-less send)", () => {
    const attachments: AcpAttachment[] = [{ kind: "image", data: "aW1n", mimeType: "image/png" }];

    expect(buildPromptContent("", attachments)).toEqual({
      prompt: [
        { type: "text", text: "" },
        { type: "image", data: "aW1n", mimeType: "image/png" },
      ],
      notes: [],
    });
  });

  describe("file attachments → embedded resource", () => {
    it("sends a textual file as ACP TextResourceContents, decoded", () => {
      const attachments: AcpAttachment[] = [
        {
          kind: "file",
          data: b64("# Title\n\n你好"),
          mimeType: "text/markdown",
          filename: "a b.md",
        },
      ];

      expect(buildPromptContent("read this", attachments, { embeddedContext: true })).toEqual({
        prompt: [
          { type: "text", text: "read this" },
          {
            type: "resource",
            resource: {
              uri: "attachment:///a%20b.md",
              mimeType: "text/markdown",
              text: "# Title\n\n你好",
            },
          },
        ],
        notes: [],
      });
    });

    it("sends a binary file as ACP BlobResourceContents, base64 untouched", () => {
      // A PDF header followed by a NUL byte — valid base64, but not text.
      const data = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]).toString("base64");
      const attachments: AcpAttachment[] = [
        { kind: "file", data, mimeType: "application/pdf", filename: "report.pdf" },
      ];

      expect(buildPromptContent("", attachments, { embeddedContext: true })).toEqual({
        prompt: [
          { type: "text", text: "" },
          {
            type: "resource",
            resource: { uri: "attachment:///report.pdf", mimeType: "application/pdf", blob: data },
          },
        ],
        notes: [],
      });
    });

    it("treats a browser-mislabelled .ts source file as text, not an MPEG stream", () => {
      // Browsers report `video/mp2t` for `.ts`. Sniffing the bytes is what
      // keeps a TypeScript file from being shipped as an opaque blob.
      const attachments: AcpAttachment[] = [
        {
          kind: "file",
          data: b64("export const a = 1;\n"),
          mimeType: "video/mp2t",
          filename: "a.ts",
        },
      ];

      const { prompt } = buildPromptContent("", attachments, { embeddedContext: true });
      expect(prompt[1]).toEqual({
        type: "resource",
        resource: {
          uri: "attachment:///a.ts",
          mimeType: "video/mp2t",
          text: "export const a = 1;\n",
        },
      });
    });

    it("keeps a real binary payload with an unknown MIME type as a blob", () => {
      const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64");
      const attachments: AcpAttachment[] = [
        { kind: "file", data, mimeType: "", filename: "mystery.bin" },
      ];

      const { prompt } = buildPromptContent("", attachments, { embeddedContext: true });
      expect(prompt[1]).toMatchObject({ type: "resource", resource: { blob: data } });
    });
  });

  describe("capability negotiation", () => {
    it("sends everything when no capabilities are supplied (un-negotiated host)", () => {
      const attachments: AcpAttachment[] = [
        { kind: "image", data: "aW1n", mimeType: "image/png" },
        { kind: "file", data: b64("hi"), mimeType: "text/plain", filename: "n.txt" },
      ];

      const { prompt, notes } = buildPromptContent("x", attachments);
      expect(prompt.map((block) => block.type)).toEqual(["text", "image", "resource"]);
      expect(notes).toEqual([]);
    });

    it("treats an omitted capability as unsupported, per ACP", () => {
      const attachments: AcpAttachment[] = [{ kind: "image", data: "aW1n", mimeType: "image/png" }];

      const { prompt, notes } = buildPromptContent("x", attachments, {});
      expect(prompt).toEqual([{ type: "text", text: "x" }]);
      expect(notes).toEqual(["This agent does not accept image attachments, so it was not sent."]);
    });

    it("still sends an image when the agent explicitly advertises it", () => {
      const attachments: AcpAttachment[] = [{ kind: "image", data: "aW1n", mimeType: "image/png" }];

      const { prompt, notes } = buildPromptContent("x", attachments, { image: true });
      expect(prompt.map((block) => block.type)).toEqual(["text", "image"]);
      expect(notes).toEqual([]);
    });
  });

  describe("fallback when embeddedContext is unsupported", () => {
    it("inlines a textual file into the text block and says so", () => {
      const attachments: AcpAttachment[] = [
        { kind: "file", data: b64("a,b\n1,2"), mimeType: "text/csv", filename: "data.csv" },
      ];

      const { prompt, notes } = buildPromptContent("summarise", attachments, {});
      expect(prompt).toEqual([
        {
          type: "text",
          text: "summarise\n\n--- Attached file: data.csv ---\na,b\n1,2\n--- End of attached file: data.csv ---",
        },
      ]);
      expect(notes).toEqual([
        "This agent does not accept file attachments, so data.csv was included as plain text instead.",
      ]);
    });

    it("drops a binary file it cannot inline, and explains why", () => {
      const data = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00]).toString("base64");
      const attachments: AcpAttachment[] = [
        { kind: "file", data, mimeType: "application/pdf", filename: "report.pdf" },
      ];

      const { prompt, notes } = buildPromptContent("read it", attachments, {});
      expect(prompt).toEqual([{ type: "text", text: "read it" }]);
      expect(notes).toEqual([
        "This agent does not accept file attachments, and report.pdf is not text, so it was not sent.",
      ]);
    });

    it("inlines a text-only prompt's file even when the user wrote nothing", () => {
      const attachments: AcpAttachment[] = [
        { kind: "file", data: b64("hello"), mimeType: "text/plain", filename: "n.txt" },
      ];

      const { prompt } = buildPromptContent("", attachments, {});
      expect(prompt).toEqual([
        {
          type: "text",
          text: "--- Attached file: n.txt ---\nhello\n--- End of attached file: n.txt ---",
        },
      ]);
    });

    it("lists several degraded files in one note", () => {
      const attachments: AcpAttachment[] = [
        { kind: "file", data: b64("1"), mimeType: "text/plain", filename: "a.txt" },
        { kind: "file", data: b64("2"), mimeType: "text/plain", filename: "b.txt" },
        { kind: "file", data: b64("3"), mimeType: "text/plain", filename: "c.txt" },
      ];

      const { notes } = buildPromptContent("", attachments, {});
      expect(notes).toEqual([
        "This agent does not accept file attachments, so a.txt, b.txt, and c.txt were included as plain text instead.",
      ]);
    });
  });
});
