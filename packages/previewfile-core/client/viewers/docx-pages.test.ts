import { describe, expect, it } from "vitest";
import { DOCX_PAGE_CLASS, deferOffscreenPages, dropBreakOnlyPages } from "./docx-pages";

/** What docx-preview renders: a wrapper, and a `<section>` per page with its size inline. */
const render = (pages: string[]) => {
  const container = document.createElement("div");
  container.innerHTML = `<div class="${DOCX_PAGE_CLASS}-wrapper">${pages
    .map(
      (style) =>
        `<section class="${DOCX_PAGE_CLASS}" style="${style}"><article>text</article></section>`,
    )
    .join("")}</div>`;
  return [container, [...container.querySelectorAll<HTMLElement>("section")]] as const;
};

describe("deferOffscreenPages", () => {
  it("skips off-screen pages, each holding the height of an empty page", () => {
    // Letter paper, 72pt margins: 792pt = 1056px tall, 192px of it padding.
    const [container, [page]] = render(["padding: 72pt 90pt; width: 612pt; min-height: 792pt;"]);
    deferOffscreenPages(container);
    expect(page.style.getPropertyValue("content-visibility")).toBe("auto");
    expect(page.style.getPropertyValue("contain-intrinsic-height")).toBe("auto 864px");
  });

  it("sizes every page by its own paper and margins", () => {
    const [container, pages] = render([
      "padding: 72pt 90pt; width: 612pt; min-height: 792pt;",
      // A4 landscape, 36pt margins, written in pixels.
      "padding: 48px 48px; width: 1123px; min-height: 794px;",
    ]);
    deferOffscreenPages(container);
    expect(pages.map((p) => p.style.getPropertyValue("contain-intrinsic-height"))).toEqual([
      "auto 864px",
      "auto 698px",
    ]);
  });

  it("leaves a page alone when its size is not written down", () => {
    const [container, [page]] = render(["width: 612pt;"]);
    deferOffscreenPages(container);
    expect(page.style.getPropertyValue("content-visibility")).toBe("");
  });

  it("leaves a page alone when its margins leave no room for content", () => {
    const [container, [page]] = render(["padding: 400pt 0; min-height: 792pt;"]);
    deferOffscreenPages(container);
    expect(page.style.getPropertyValue("content-visibility")).toBe("");
  });

  it("only touches pages, not the sections inside one", () => {
    const container = document.createElement("div");
    container.innerHTML = `<div class="${DOCX_PAGE_CLASS}-wrapper"><section class="${DOCX_PAGE_CLASS}" style="padding: 72pt; min-height: 792pt;"><article><section class="${DOCX_PAGE_CLASS}" style="min-height: 100pt;">inner</section></article></section></div>`;
    deferOffscreenPages(container);
    const [outer, inner] = [...container.querySelectorAll<HTMLElement>("section")];
    expect(outer.style.getPropertyValue("content-visibility")).toBe("auto");
    expect(inner.style.getPropertyValue("content-visibility")).toBe("");
  });
});

/** Pages as docx-preview renders them: a header, the body in an `<article>`, a footer. */
const renderBodies = (bodies: string[], headerAndFooter = "") => {
  const container = document.createElement("div");
  container.innerHTML = `<div class="${DOCX_PAGE_CLASS}-wrapper">${bodies
    .map(
      (body) =>
        `<section class="${DOCX_PAGE_CLASS}"><header>${headerAndFooter}</header><article>${body}</article><footer>${headerAndFooter}</footer></section>`,
    )
    .join("")}</div>`;
  const pagesLeft = () =>
    [...container.querySelectorAll(`.${DOCX_PAGE_CLASS}-wrapper > section`)].map((page) =>
      page.querySelector("article")?.textContent?.trim(),
    );
  return [container, pagesLeft] as const;
};

describe("dropBreakOnlyPages", () => {
  it("removes the page between a hard break and the mark Word writes after it", () => {
    // What a hard page break followed by a mark leaves: a page of one empty paragraph.
    const [container, pagesLeft] = renderBodies([
      "<p>first</p>",
      "<p><br></p>",
      "<p>second</p>",
      "<p><br></p>",
      "<p>third</p>",
    ]);
    expect(dropBreakOnlyPages(container)).toBe(2);
    expect(pagesLeft()).toEqual(["first", "second", "third"]);
  });

  it("treats a page of whitespace as empty", () => {
    const [container, pagesLeft] = renderBodies(["<p>text</p>", "<p>\u00a0 </p>"]);
    expect(dropBreakOnlyPages(container)).toBe(1);
    expect(pagesLeft()).toEqual(["text"]);
  });

  it.each([
    ["a picture", '<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></p>'],
    ["a table", "<table><tbody><tr><td></td></tr></tbody></table>"],
    ["a drawing", '<p><svg width="10" height="10"></svg></p>'],
  ])("keeps a page that holds %s though it has no text", (_what, body) => {
    const [container] = renderBodies(["<p>text</p>", body]);
    expect(dropBreakOnlyPages(container)).toBe(0);
    expect(container.querySelectorAll("section")).toHaveLength(2);
  });

  it("does not count the header and footer every page repeats as the page's content", () => {
    const [container, pagesLeft] = renderBodies(["<p>text</p>", "<p><br></p>"], "Confidential");
    expect(dropBreakOnlyPages(container)).toBe(1);
    expect(pagesLeft()).toEqual(["text"]);
  });

  it("keeps one page, so a document of nothing but breaks is not left blank", () => {
    const [container] = renderBodies(["<p><br></p>", "<p><br></p>"]);
    expect(dropBreakOnlyPages(container)).toBe(0);
    expect(container.querySelectorAll("section")).toHaveLength(2);
  });

  it("leaves a document that has nothing to remove as it is", () => {
    const [container, pagesLeft] = renderBodies(["<p>a</p>", "<p>b</p>"]);
    expect(dropBreakOnlyPages(container)).toBe(0);
    expect(pagesLeft()).toEqual(["a", "b"]);
  });

  it("only looks at pages, not the sections inside one", () => {
    const container = document.createElement("div");
    container.innerHTML = `<div class="${DOCX_PAGE_CLASS}-wrapper"><section class="${DOCX_PAGE_CLASS}"><article><p>text</p><section class="${DOCX_PAGE_CLASS}"><article><p><br></p></article></section></article></section></div>`;
    expect(dropBreakOnlyPages(container)).toBe(0);
    expect(container.querySelectorAll("section")).toHaveLength(2);
  });
});
