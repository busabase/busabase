import type { BaseFieldVO } from "busabase-contract/types";
import { micromark } from "micromark";
import { type DefaultTreeAdapterMap, parseFragment } from "parse5";

const EXCLUDED_HTML_TAGS = new Set(["script", "style", "template", "head", "title"]);
const BLOCK_HTML_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

/** Static body text only: no scripts, resource fetching, or browser execution. */
export const extractRecordFindHtmlText = (source: string): string => {
  type Node = DefaultTreeAdapterMap["node"];
  const parts: string[] = [];
  const stack: Array<{ node: Node; end?: boolean }> = [{ node: parseFragment(source) }];
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    const { node, end } = entry;
    if ("tagName" in node && EXCLUDED_HTML_TAGS.has(node.tagName)) continue;
    const block = "tagName" in node && BLOCK_HTML_TAGS.has(node.tagName);
    if (block) parts.push(" ");
    if (end) continue;
    if (node.nodeName === "#text" && "value" in node) parts.push(node.value);
    if ("tagName" in node && node.tagName === "img") {
      const alt = node.attrs.find((attribute) => attribute.name === "alt");
      if (alt) parts.push(alt.value);
    }
    if ("childNodes" in node) {
      if (block) stack.push({ node, end: true });
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        const child = node.childNodes[index];
        if (child) stack.push({ node: child });
      }
    }
  }
  return parts.join("").replace(/\s+/g, " ").trim();
};

const scalarText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";

/** Independent strings prevent a phrase from matching across separate option labels. */
export const getRecordFindTexts = (field: BaseFieldVO, value: unknown): string[] => {
  if (value === null || value === undefined) return [];
  if (field.type === "html") return [extractRecordFindHtmlText(scalarText(value))];
  if (field.type === "markdown") {
    return [
      extractRecordFindHtmlText(
        micromark(scalarText(value), { allowDangerousHtml: true, allowDangerousProtocol: false }),
      ),
    ];
  }
  if (field.type === "select" || field.type === "multiselect") {
    return (Array.isArray(value) ? value : [value]).map((item) => {
      const text = scalarText(item);
      return field.options.choices?.find((choice) => choice.id === text)?.name ?? text;
    });
  }
  if (field.type === "attachment") {
    return (Array.isArray(value) ? value : [value]).flatMap((item) =>
      typeof item === "object" && item !== null && "fileName" in item
        ? [scalarText(item.fileName)]
        : [],
    );
  }
  if (field.type === "ai_tags") {
    return (Array.isArray(value) ? value : [value]).map(scalarText);
  }
  if (field.type === "auto_number") {
    const text = scalarText(value);
    return text ? [text, `#${text}`] : [];
  }
  return [scalarText(value)];
};

export const recordFindTextMatches = (texts: ReadonlyArray<string>, query: string): boolean =>
  texts.some((text) => text.toLowerCase().includes(query));
