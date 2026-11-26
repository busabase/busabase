import type { Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { type DefaultTreeAdapterMap, parseFragment } from "parse5";

const TOKEN = /^fd-llms-image-[a-f0-9]{64}-x*\d+$/;

export const hasLlmsImageTokens = (text: string): boolean =>
  /fd-llms-image-[a-f0-9]{64}-x*\d+/.test(text);

/** Only resolved public URL values may leave a compiled module as image references. */
const isPublicImageUrl = (value: unknown): boolean => {
  if (
    typeof value !== "string" ||
    /[\s\\<>"']/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    return false;
  if (value.startsWith("/_next/static/media/") || value.startsWith("/assets/")) {
    const normalized = new URL(value, "https://static.invalid");
    return `${normalized.pathname}${normalized.search}${normalized.hash}` === value;
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
};

const exportedMap = (data: unknown): unknown => {
  if (!data || typeof data !== "object" || !("_exports" in data)) return undefined;
  const exports = data._exports;
  return exports && typeof exports === "object" && "_llmsImageSources" in exports
    ? exports._llmsImageSources
    : undefined;
};

/** Ordinary Fumadocs records keep exports directly; async records expose them via load(). */
export const resolveLlmsImageSources = async (data: object): Promise<unknown> => {
  const direct = exportedMap(data);
  if (direct !== undefined) return direct;
  if ("load" in data && typeof data.load === "function") return exportedMap(await data.load());
  return undefined;
};

/** Literal Markdown/HTML may use ordinary public relative paths, as well as remote URLs. */
const isImageReference = (value: string): boolean => {
  if (!value || hasLlmsImageTokens(value) || /[\s\\<>"'{}]/.test(value)) return false;
  if (isPublicImageUrl(value)) return true;
  // A bare JS identifier/member is not a filename. A bare relative image filename is valid.
  if (/^(?:[\w.-]+\/)*[\w.-]+\.(?:png|webp|svg|jpe?g|avif|gif|ico)(?:[?#].*)?$/i.test(value))
    return true;
  return /^(?:\/(?!\/)|\.\.?\/)/.test(value) && !value.includes(":");
};

type ImageReference = { value: string; start?: number; end?: number };

/** Parse the output as Markdown first: code examples and ordinary token-shaped text are inert. */
const imageReferences = (text: string): ImageReference[] => {
  const tree = fromMarkdown(text);
  const references: ImageReference[] = [];
  const htmlRanges: Array<{ start: number; end: number }> = [];
  const definitions = new Map<string, string>();
  const collectDefinitions = (node: Root | RootContent) => {
    if (node.type === "definition" && !definitions.has(node.identifier.toUpperCase()))
      definitions.set(node.identifier.toUpperCase(), node.url);
    if ("children" in node) for (const child of node.children) collectDefinitions(child);
  };
  collectDefinitions(tree);
  const visit = (node: Root | RootContent) => {
    if (node.type === "image") references.push({ value: node.url });
    if (node.type === "imageReference") {
      const value = definitions.get(node.identifier.toUpperCase());
      if (value !== undefined) references.push({ value });
    }
    if (node.type === "html") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) htmlRanges.push({ start, end });
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(tree);
  // Keep HTML nesting (e.g. SVG <image href>) across Markdown's separate inline HTML nodes.
  // Mask code/text instead of parsing it as HTML, retaining original UTF-16 source offsets.
  if (htmlRanges.length) {
    let htmlText = text.replace(/[^\n\r]/g, " ");
    for (const { start, end } of htmlRanges)
      htmlText = htmlText.slice(0, start) + text.slice(start, end) + htmlText.slice(end);
    const html = parseFragment(htmlText, { sourceCodeLocationInfo: true });
    const visitHtml = (element: DefaultTreeAdapterMap["node"]) => {
      if ("tagName" in element) {
        if (["pre", "code", "script", "style"].includes(element.tagName)) return;
        if (
          element.namespaceURI === "http://www.w3.org/1999/xhtml" &&
          (element.tagName === "img" || element.tagName === "image")
        ) {
          const src = element.attrs.find((attribute) => attribute.name === "src");
          const location = element.sourceCodeLocation?.attrs?.src;
          references.push({
            value: src?.value ?? "",
            start: location?.startOffset,
            end: location?.endOffset,
          });
        }
      }
      if ("childNodes" in element) for (const child of element.childNodes) visitHtml(child);
    };
    visitHtml(html);
  }
  return references;
};

export const countUnresolvedLlmsImages = (text: string): number =>
  imageReferences(text).filter(({ value }) => !isImageReference(value)).length;

export const needsLlmsImageSources = (text: string): boolean =>
  imageReferences(text).some(({ value }) => TOKEN.test(value));

/** Replace only compiler-minted tokens in actual image attributes, preserving every other byte. */
export const restoreLlmsImageSources = (text: string, assets: unknown): string => {
  if (!assets || typeof assets !== "object" || Array.isArray(assets)) return text;
  const replacements = new Map(
    Object.entries(assets).filter(([token, value]) => TOKEN.test(token) && isPublicImageUrl(value)),
  );
  if (!replacements.size) return text;
  const edits = imageReferences(text)
    .filter(
      ({ value, start, end }) =>
        replacements.has(value) && start !== undefined && end !== undefined,
    )
    .sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
  for (const { value, start, end } of edits) {
    if (start === undefined || end === undefined) continue;
    const attribute = text.slice(start, end).replace(value, replacements.get(value) as string);
    text = text.slice(0, start) + attribute + text.slice(end);
  }
  return text;
};
