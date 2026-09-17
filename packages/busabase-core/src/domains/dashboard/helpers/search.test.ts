import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { highlightSearchText, searchSnippetText } from "./search";

describe("search presentation helpers", () => {
  it("removes markup and collapses whitespace from result snippets", () => {
    expect(
      searchSnippetText(
        "<article><h2>Title</h2>  <p>Body</p></article> ## Heading **bold** [link](/docs)",
      ),
    ).toBe("Title Body Heading bold link");
  });

  it("highlights query matches without injecting raw HTML", () => {
    const markup = renderToStaticMarkup(highlightSearchText("AI <script>", "AI"));
    expect(markup).toContain("<mark");
    expect(markup).toContain("AI");
    expect(markup).toContain("&lt;script&gt;");
  });
});
