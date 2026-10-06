import { createMarkdownRenderer, type MarkdownProps } from "fumadocs-core/content/md";
import { getTableOfContents } from "fumadocs-core/content/toc";
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading";
import type { TOCItemType } from "fumadocs-core/toc";
import type { Element, Root } from "hast";
import { type ComponentProps, createElement, type ElementType, type ReactNode } from "react";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import sanitizeHtml from "sanitize-html";
import type { PageVO } from "./types";

/** rehype-sanitize's default `clobberPrefix`: every rendered `id` carries it. */
const SAFE_ID_PREFIX = "user-content-";

/**
 * rehype-sanitize prefixes every `id` to block DOM clobbering, but leaves in-page `#fragment`
 * links untouched — and GFM footnote ids arrive already prefixed, so they get it twice. Collapse
 * the doubled prefix, then point each in-page link at the id that was actually rendered.
 */
const rehypeSafeAnchors = () => (tree: Root) => {
  const ids = new Set<string>();
  const links: Element[] = [];
  const walk = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      const { id, href } = child.properties;
      if (typeof id === "string") {
        const single = id.replace(`${SAFE_ID_PREFIX}${SAFE_ID_PREFIX}`, SAFE_ID_PREFIX);
        child.properties.id = single;
        ids.add(single);
      }
      if (child.tagName === "a" && typeof href === "string" && href.startsWith("#")) {
        links.push(child);
      }
      walk(child);
    }
  };
  walk(tree);
  for (const link of links) {
    const href = link.properties.href as string;
    let fragment = href.slice(1);
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      // Keep a malformed escape as written; it simply won't match a heading.
    }
    if (!ids.has(fragment) && ids.has(`${SAFE_ID_PREFIX}${fragment}`)) {
      link.properties.href = `#${SAFE_ID_PREFIX}${fragment}`;
    }
  }
};

const safeMarkdownRenderer = createMarkdownRenderer({
  remarkPlugins: [remarkGfm, remarkHeading],
  rehypePlugins: [rehypeSanitize, rehypeSafeAnchors],
});

type MarkdownComponents = NonNullable<MarkdownProps["components"]>;

/**
 * Components that render a body `# Heading` as `<h2>`, for pages whose template already owns
 * the page's only `<h1>` (e.g. a Blog post title). Text, id and anchors are unchanged; a caller's
 * own `h2` component is reused. Also usable for local MDX bodies.
 */
export const withDemotedH1 = <T extends Record<string, unknown>>(components?: T) => {
  const H2 = (components?.h2 ?? "h2") as ElementType;
  return {
    ...components,
    h1: (props: ComponentProps<"h1">) => createElement(H2, props),
  };
};

/** Shift `depth: 1` TOC entries to 2 to match a body rendered with `withDemotedH1`. */
export const demoteTocH1 = (toc: TOCItemType[]): TOCItemType[] =>
  toc.map((item) => (item.depth === 1 ? { ...item, depth: 2 } : item));

export interface SafeMarkdownProps {
  children: string;
  components?: MarkdownComponents;
  /** Render body H1 as H2 because the surrounding template owns the page H1. */
  demoteH1?: boolean;
}

/** Render stored Markdown without MDX execution or raw HTML passthrough. */
export const SafeMarkdown = async ({
  children,
  components,
  demoteH1 = false,
}: SafeMarkdownProps): Promise<ReactNode> =>
  safeMarkdownRenderer.MarkdownServer({
    children,
    components: demoteH1 ? (withDemotedH1(components) as MarkdownComponents) : components,
  });

export interface SafeMarkdownTocOptions {
  /** Match `SafeMarkdown`'s `demoteH1`: report body H1 entries at depth 2. */
  demoteH1?: boolean;
}

/** TOC for `SafeMarkdown`; each `url` targets the id `SafeMarkdown` actually renders. */
export const getSafeMarkdownToc = async (
  markdown: string,
  { demoteH1 = false }: SafeMarkdownTocOptions = {},
): Promise<TOCItemType[]> => {
  const toc = (await getTableOfContents(markdown, [remarkGfm])).map((item) =>
    item.url.startsWith("#") ? { ...item, url: `#${SAFE_ID_PREFIX}${item.url.slice(1)}` } : item,
  );
  return demoteH1 ? demoteTocH1(toc) : toc;
};

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
      a: (tagName: string, attribs: Record<string, string>) => ({
        tagName,
        attribs: attribs.target === "_blank" ? { ...attribs, rel: "noopener noreferrer" } : attribs,
      }),
    },
  });

/**
 * Sanitize a CMS Page's stored body for injection. Lives here, next to the sanitizer it wraps,
 * rather than in `busabase-cms-sdk/integration`: `sanitizeLandingPageHtml` drags in remark, rehype
 * and sanitize-html, and only the component that actually injects the HTML should pay for that.
 *
 * Call this immediately before injecting — the sanitize step must never move up to the caller.
 */
export const getSanitizedCmsPageBody = (page: Pick<PageVO, "body">): string =>
  sanitizeLandingPageHtml(page.body);
