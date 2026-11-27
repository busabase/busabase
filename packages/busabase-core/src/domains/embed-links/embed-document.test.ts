import { describe, expect, it } from "vitest";
import { renderExpiredEmbedDocument, renderUnavailableEmbedDocument } from "./embed-document";

describe("embed status documents", () => {
  it("answers in the visitor's language without product chrome", () => {
    const html = renderUnavailableEmbedDocument("zh-CN,zh;q=0.9,en;q=0.8");

    expect(html).toContain("内容不可用");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<header");
    expect(html).not.toContain('rel="icon"');
  });

  it("falls back to English and keeps expired distinct from unavailable", () => {
    expect(renderExpiredEmbedDocument("xx-YY")).toContain("Link expired");
    expect(renderUnavailableEmbedDocument(null)).toContain("Content unavailable");
  });
});
