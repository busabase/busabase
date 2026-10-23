import { describe, expect, it } from "vitest";
import { HTML_DOCUMENT_SANDBOX, isFullHtmlDocument, stripHtmlTags } from "./html";

describe("isFullHtmlDocument", () => {
  it("recognizes a whole page", () => {
    expect(isFullHtmlDocument("<!doctype html><html><body>x</body></html>")).toBe(true);
    expect(isFullHtmlDocument('<!DOCTYPE HTML>\n<html lang="zh-CN">')).toBe(true);
    expect(isFullHtmlDocument("  \n<html><body>x</body></html>")).toBe(true);
    expect(isFullHtmlDocument("<html lang=en>")).toBe(true);
    expect(isFullHtmlDocument("<!-- generated -->\n<!doctype html><html></html>")).toBe(true);
  });

  it("leaves rich-text fragments on the inline path", () => {
    expect(isFullHtmlDocument("<p>Hello <b>world</b></p>")).toBe(false);
    expect(isFullHtmlDocument("<div><style>p{color:red}</style><p>x</p></div>")).toBe(false);
    expect(isFullHtmlDocument("Plain text that mentions <html> later")).toBe(false);
    expect(isFullHtmlDocument("<p>see <!doctype html> below</p>")).toBe(false);
    expect(isFullHtmlDocument("<htmlfoo>not a page</htmlfoo>")).toBe(false);
    expect(isFullHtmlDocument("")).toBe(false);
  });

  it("sandboxes pages without scripts or same-origin access", () => {
    const tokens = HTML_DOCUMENT_SANDBOX.split(/\s+/);
    expect(tokens).not.toContain("allow-scripts");
    expect(tokens).not.toContain("allow-same-origin");
    expect(tokens).toContain("allow-popups");
  });
});

describe("stripHtmlTags", () => {
  it("keeps a page's stylesheet, title and comments out of the plain-text cell", () => {
    const page =
      "<!doctype html><html><head><title>Weekly</title><style>.a{color:red}</style></head>" +
      "<body><!-- a > b --><h1>周报</h1><p>结论</p><script>alert(1)</script></body></html>";
    expect(stripHtmlTags(page)).toBe("周报 结论");
  });

  it("still flattens fragments the same way", () => {
    expect(stripHtmlTags("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });
});
