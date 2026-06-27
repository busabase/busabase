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
    const srcValue = srcAttr?.[1] ?? "";
    const safeSrc = srcValue && isSafeUrl(srcValue) ? ` src="${escapeHtml(srcValue)}"` : "";
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
