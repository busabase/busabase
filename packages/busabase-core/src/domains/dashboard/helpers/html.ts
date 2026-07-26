export const stripHtmlTags = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const allowedHtmlTags = new Set([
  "a",
  "article",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "figure",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "header",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

export const voidHtmlTags = new Set(["br", "hr"]);

export const isSafeUrl = (value: string) =>
  value.startsWith("/") ||
  value.startsWith("#") ||
  /^https?:\/\//i.test(value) ||
  /^mailto:/i.test(value) ||
  /^tel:/i.test(value);

export const isSafeFetchableUrl = (value: string) =>
  value.startsWith("/") || /^https?:\/\//i.test(value);

export const safeFetchableUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed && isSafeFetchableUrl(trimmed) ? trimmed : null;
};

export const sanitizeHtmlTag = (rawTag: string) => {
  const tagMatch = rawTag.match(/^<\s*(\/)?\s*([a-zA-Z0-9-]+)/);
  if (!tagMatch) {
    return "";
  }

  const isClosing = Boolean(tagMatch[1]);
  const tagName = tagMatch[2]?.toLowerCase() ?? "";
  if (!allowedHtmlTags.has(tagName)) {
    return "";
  }

  if (isClosing) {
    return voidHtmlTags.has(tagName) ? "" : `</${tagName}>`;
  }

  // Shared attribute extraction helpers (safe subsets only)
  const classAttr = rawTag.match(/\s+class\s*=\s*"([^"]*)"/i);
  const safeClass = classAttr?.[1] ? ` class="${escapeHtml(classAttr[1])}"` : "";

  const styleAttr = rawTag.match(/\s+style\s*=\s*"([^"]*)"/i);
  const rawStyle = styleAttr?.[1] ?? "";
  const safeStyleValue = rawStyle
    .replace(/javascript\s*:/gi, "")
    .replace(/expression\s*\(/gi, "")
    .replace(/url\s*\(\s*["']?\s*javascript/gi, "");
  const safeStyle = safeStyleValue.trim() ? ` style="${escapeHtml(safeStyleValue)}"` : "";

  const sharedAttrs = `${safeClass}${safeStyle}`;

  if (tagName === "a") {
    const href = rawTag.match(/\s+href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const hrefValue = href?.[2] ?? href?.[3] ?? href?.[4] ?? "";
    const safeHref = hrefValue && isSafeUrl(hrefValue) ? ` href="${escapeHtml(hrefValue)}"` : "";
    return `<a${safeHref} target="_blank" rel="noreferrer"${sharedAttrs}>`;
  }

  if (tagName === "img") {
    const srcAttr = rawTag.match(/\s+src\s*=\s*"([^"]*)"/i);
    const altAttr = rawTag.match(/\s+alt\s*=\s*"([^"]*)"/i);
    const srcValue = safeFetchableUrl(srcAttr?.[1]);
    const safeSrc = srcValue ? ` src="${escapeHtml(srcValue)}"` : "";
    const safeAlt = altAttr?.[1] ? ` alt="${escapeHtml(altAttr[1])}"` : "";
    return `<img${safeSrc}${safeAlt}${sharedAttrs}>`;
  }

  return voidHtmlTags.has(tagName) ? `<${tagName}${sharedAttrs}>` : `<${tagName}${sharedAttrs}>`;
};

export const sanitizeHtml = (value: string) => {
  const withoutDangerousBlocks = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|svg|math|link|meta)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|svg|math|link|meta)[^>]*>/gi, "");

  let sanitized = "";
  let lastIndex = 0;
  for (const match of withoutDangerousBlocks.matchAll(/<\/?[^>]+>/g)) {
    sanitized += escapeHtml(withoutDangerousBlocks.slice(lastIndex, match.index));
    sanitized += sanitizeHtmlTag(match[0]);
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  sanitized += escapeHtml(withoutDangerousBlocks.slice(lastIndex));
  return sanitized;
};

// SVG-specific allowlist for the `whiteboard` field type's stored `previewSvg`
// snapshot. That string round-trips through the same API surface as any other
// field value (busabase-cli / API / MCP writes, not just the trusted in-app
// Excalidraw exporter that normally produces it) — so it must be sanitized at
// render time exactly like sanitizeHtml above, not trusted as "our own markup".
// Deliberately drops <script>, <foreignObject> (can smuggle arbitrary HTML),
// <image>/<a> (remote/javascript: URLs), animate* (SMIL event-like triggers),
// and <style> (CSS injection via url()/expression()) — real Excalidraw scene
// exports don't need any of those given this field's scene schema has no
// embedded-file support. Losing the hand-drawn Virgil webfont declaration in
// the process is an accepted cosmetic trade for not having to also sanitize
// arbitrary CSS.
const allowedSvgTags = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "pattern",
  "marker",
  "use",
]);

const allowedSvgAttrs = new Set([
  "id",
  "class",
  "transform",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "viewbox",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-opacity",
  "opacity",
  "points",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "gradienttransform",
  "patterntransform",
  "patternunits",
  "patterncontentunits",
  "markerwidth",
  "markerheight",
  "markerunits",
  "orient",
  "refx",
  "refy",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "clip-path",
  "mask",
  "preserveaspectratio",
  "xmlns",
  "version",
  "spreadmethod",
]);

const sanitizeSvgTag = (rawTag: string) => {
  const tagMatch = rawTag.match(/^<\s*(\/)?\s*([a-zA-Z0-9:-]+)/);
  if (!tagMatch) {
    return "";
  }

  const isClosing = Boolean(tagMatch[1]);
  const tagName = tagMatch[2]?.toLowerCase().replace(/^svg:/, "") ?? "";
  if (!allowedSvgTags.has(tagName)) {
    return "";
  }

  if (isClosing) {
    return `</${tagName}>`;
  }

  const selfClosing = /\/\s*>\s*$/.test(rawTag);
  let attrs = "";
  for (const attrMatch of rawTag.matchAll(/([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*"([^"]*)"/g)) {
    const attrName = attrMatch[1]?.toLowerCase() ?? "";
    const attrValue = attrMatch[2] ?? "";
    if (attrName.startsWith("on") || !allowedSvgAttrs.has(attrName)) {
      continue;
    }
    if (/javascript\s*:/i.test(attrValue) || /expression\s*\(/i.test(attrValue)) {
      continue;
    }
    attrs += ` ${attrName}="${escapeHtml(attrValue)}"`;
  }

  return `<${tagName}${attrs}${selfClosing ? " />" : ">"}`;
};

export const sanitizeSvg = (value: string) => {
  const withoutDangerousBlocks = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(
      /<(script|foreignobject|image|a|iframe|object|embed|animate|animatemotion|animatetransform|set|style|link|meta)[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(
      /<(script|foreignobject|image|a|iframe|object|embed|animate|animatemotion|animatetransform|set|style|link|meta)[^>]*\/?>/gi,
      "",
    );

  let sanitized = "";
  let lastIndex = 0;
  for (const match of withoutDangerousBlocks.matchAll(/<\/?[^>]+>/g)) {
    sanitized += escapeHtml(withoutDangerousBlocks.slice(lastIndex, match.index));
    sanitized += sanitizeSvgTag(match[0]);
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  sanitized += escapeHtml(withoutDangerousBlocks.slice(lastIndex));
  return sanitized;
};
