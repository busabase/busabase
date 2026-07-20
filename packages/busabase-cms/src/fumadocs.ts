import { createMarkdownRenderer, type MarkdownProps } from "fumadocs-core/content";
import { getTableOfContents } from "fumadocs-core/content/toc";
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading";
import type { TOCItemType } from "fumadocs-core/toc";
import type { ReactNode } from "react";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import sanitizeHtml from "sanitize-html";

const safeMarkdownRenderer = createMarkdownRenderer({
  remarkPlugins: [remarkGfm, remarkHeading],
  rehypePlugins: [rehypeSanitize],
});

export interface SafeMarkdownProps {
  children: string;
  components?: MarkdownProps["components"];
}

/** Render stored Markdown without MDX execution or raw HTML passthrough. */
export const SafeMarkdown = async ({
  children,
  components,
}: SafeMarkdownProps): Promise<ReactNode> =>
  safeMarkdownRenderer.MarkdownServer({ children, components });

export const getSafeMarkdownToc = async (markdown: string): Promise<TOCItemType[]> =>
  getTableOfContents(markdown, [remarkGfm]);

const safeCssValue = /^(?!.*(?:url|expression|@import|javascript))[-a-zA-Z0-9#(),.%\s/]+$/i;
const safeLength =
  /^(?!.*(?:url|expression|@import|javascript))(?:0|auto|none|(?:min|max|clamp|calc)\([^;{}]+\)|[0-9.]+(?:px|rem|em|%|vh|vw|ch))$/i;

/** Sanitize stored Landing Page HTML before passing it to `dangerouslySetInnerHTML`. */
export const sanitizeLandingPageHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: [
      "article",
      "section",
      "div",
      "span",
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "a",
      "strong",
      "em",
      "b",
      "i",
      "s",
      "blockquote",
      "code",
      "pre",
      "ul",
      "ol",
      "li",
      "dl",
      "dt",
      "dd",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "figure",
      "figcaption",
      "picture",
      "source",
      "img",
      "details",
      "summary",
      "hr",
      "br",
    ],
    allowedAttributes: {
      "*": ["id", "style", "role", "aria-label", "aria-labelledby", "aria-describedby"],
      a: ["href", "name", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
      source: ["src", "srcset", "media", "type", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https"],
      source: ["http", "https"],
    },
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    allowedStyles: {
      "*": {
        display: [/^(?:block|inline|inline-block|flex|inline-flex|grid|none)$/],
        "flex-direction": [/^(?:row|row-reverse|column|column-reverse)$/],
        "flex-wrap": [/^(?:nowrap|wrap|wrap-reverse)$/],
        "align-items": [/^(?:normal|stretch|center|start|end|flex-start|flex-end|baseline)$/],
        "justify-content": [
          /^(?:normal|stretch|center|start|end|flex-start|flex-end|space-between|space-around|space-evenly)$/,
        ],
        "grid-template-columns": [safeCssValue],
        "grid-template-rows": [safeCssValue],
        "grid-column": [safeCssValue],
        "grid-row": [safeCssValue],
        gap: [safeLength],
        "column-gap": [safeLength],
        "row-gap": [safeLength],
        width: [safeLength],
        "min-width": [safeLength],
        "max-width": [safeLength],
        height: [safeLength],
        "min-height": [safeLength],
        "max-height": [safeLength],
        margin: [safeCssValue],
        "margin-top": [safeLength],
        "margin-right": [safeLength],
        "margin-bottom": [safeLength],
        "margin-left": [safeLength],
        padding: [safeCssValue],
        "padding-top": [safeLength],
        "padding-right": [safeLength],
        "padding-bottom": [safeLength],
        "padding-left": [safeLength],
        color: [safeCssValue],
        background: [safeCssValue],
        "background-color": [safeCssValue],
        border: [safeCssValue],
        "border-bottom": [safeCssValue],
        "border-left": [safeCssValue],
        "border-right": [safeCssValue],
        "border-top": [safeCssValue],
        "border-color": [safeCssValue],
        "border-width": [safeLength],
        "border-style": [/^(?:none|solid|dashed|dotted)$/],
        "border-radius": [safeLength],
        "font-size": [safeLength],
        "font-family": [safeCssValue],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/],
        "line-height": [safeCssValue],
        "text-align": [/^(?:start|end|left|right|center|justify)$/],
        "text-decoration": [safeCssValue],
        "text-transform": [/^(?:none|capitalize|uppercase|lowercase)$/],
        "object-fit": [/^(?:contain|cover|fill|none|scale-down)$/],
        overflow: [/^(?:visible|hidden|clip|scroll|auto)$/],
        "overflow-x": [/^(?:visible|hidden|clip|scroll|auto)$/],
        "overflow-y": [/^(?:visible|hidden|clip|scroll|auto)$/],
        opacity: [/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/],
      },
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: attribs.target === "_blank" ? { ...attribs, rel: "noopener noreferrer" } : attribs,
      }),
    },
  });
