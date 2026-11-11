/** The class docx-preview gives each page (`<section>`), and `-wrapper` the element around them. */
export const DOCX_PAGE_CLASS = "docx-preview-wrapper";

const PX_PER_PT = 96 / 72;

/** The pages of a rendered document: not the sections nested inside one. */
const PAGES = `.${DOCX_PAGE_CLASS}-wrapper > section.${DOCX_PAGE_CLASS}`;

/** What a page can hold that is content although it is not text. */
const NON_TEXT_CONTENT =
  "img, svg, canvas, table, object, embed, video, audio, iframe, math, input";

/** A length docx-preview wrote into a page's inline style ("792pt", "96px"), in pixels. */
function inlinePx(length: string): number | null {
  const value = Number.parseFloat(length);
  if (!Number.isFinite(value)) return null;
  return length.trim().endsWith("pt") ? value * PX_PER_PT : value;
}

/**
 * docx-preview puts every page of a document into the page at once, so a long
 * or table-heavy one freezes the browser while it lays all of that out. Pages
 * that are off screen are skipped (`content-visibility: auto`) until they
 * scroll into view; each holds the height an empty page has meanwhile, and
 * remembers its real one once seen, so the scrollbar stays put.
 *
 * Reads the page's own inline style, never its layout: asking for layout here
 * would be the very cost this avoids.
 */
export function deferOffscreenPages(container: HTMLElement): void {
  for (const page of container.querySelectorAll<HTMLElement>(PAGES)) {
    const { minHeight, paddingTop, paddingBottom } = page.style;
    const min = inlinePx(minHeight);
    // The page is border-box: the empty page's content area is what is left of
    // its minimum height inside the padding.
    const content =
      min === null ? null : min - (inlinePx(paddingTop) ?? 0) - (inlinePx(paddingBottom) ?? 0);
    if (content === null || content <= 0) continue;
    page.style.setProperty("content-visibility", "auto");
    page.style.setProperty("contain-intrinsic-height", `auto ${Math.round(content)}px`);
  }
}

/**
 * Word writes `<w:lastRenderedPageBreak/>` wherever it broke a page by itself,
 * and docx-preview can start a new page at each, so a flowing document is
 * paged the way Word paged it — and `deferOffscreenPages` has pages to defer:
 * without the marks, a document with no hard page break is one enormous page.
 *
 * Word also writes a mark in the first run after a hard page break, which
 * docx-preview then answers with a second break: the page between the two is
 * nothing but the paragraph that holds the first. This removes such pages — no
 * text and no picture, table or the like in the page's body (headers and
 * footers repeat on every page and say nothing). It keeps one page in any
 * case, so a document of nothing but breaks is not left blank.
 *
 * Returns how many pages it removed. A blank page the author meant, made of
 * hard breaks alone, goes with them.
 */
export function dropBreakOnlyPages(container: HTMLElement): number {
  const emptyPages = [...container.querySelectorAll<HTMLElement>(PAGES)].filter((page) => {
    const body = page.querySelector(":scope > article");
    return body !== null && !body.textContent?.trim() && !body.querySelector(NON_TEXT_CONTENT);
  });
  const pageCount = container.querySelectorAll(PAGES).length;
  if (emptyPages.length >= pageCount) return 0;
  for (const page of emptyPages) page.remove();
  return emptyPages.length;
}
