import { describe, expect, it } from "vitest";
import { renderEmbedDocument } from "./embed-document";
import type { EmbedNodeDetailVO } from "./types";

describe("embed document rendering", () => {
  it("escapes node and folder content without adding product chrome", () => {
    const title = 'Client <script>alert("title")</script>';
    const detail = {
      type: "folder",
      folder: {
        node: { name: title },
        children: [{ id: "node_1", name: "<img src=x onerror=alert(1)>", type: "doc" }],
      },
    } as unknown as EmbedNodeDetailVO;

    const html = renderEmbedDocument(detail, title);

    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<header");
    expect(html).not.toContain('rel="icon"');
  });

  it("renders Markdown while escaping raw HTML and dangerous protocols", () => {
    const detail = {
      type: "doc",
      doc: {
        node: { name: "Review" },
        body: "# Result\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))",
      },
    } as unknown as EmbedNodeDetailVO;

    const html = renderEmbedDocument(detail, "Review");

    expect(html).toContain("<h1>Result</h1>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('href="javascript:');
  });

  it("does not emit unsafe file links", () => {
    const detail = {
      type: "file",
      file: {
        node: { name: "Unsafe file" },
        asset: {
          fileName: "payload.txt",
          mimeType: "text/plain",
          size: 12,
          contentHash: null,
          url: "javascript:alert(1)",
        },
      },
    } as unknown as EmbedNodeDetailVO;

    const html = renderEmbedDocument(detail, "Unsafe file");

    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("<span>Open file</span>");
  });
});
