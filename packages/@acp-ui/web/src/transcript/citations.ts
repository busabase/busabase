import type { AcpMessageBlock } from "@acp-ui/core/reduce";
import { fromMarkdown } from "mdast-util-from-markdown";

export interface AcpCitation {
  /** UTF-16 display offsets derived from the provider's code-point offsets. */
  start: number;
  end: number;
  url: string;
  title: string;
  sourceId: string;
  quote: string;
}
export interface AcpCitationPresentation {
  kind: "absent" | "invalid" | "valid";
  partial?: boolean;
  citations: AcpCitation[];
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const safeHttp = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/** Provider adaptation is isolated here; the generic reducer only preserves metadata. */
export function citationPresentation(block: AcpMessageBlock): AcpCitationPresentation {
  const metadata = record(block._meta?.["bunny-agent/providerMetadata"]);
  const contract = record(record(metadata?.["bunny-agent"])?.citation_contract);
  if (!contract || contract.schema_version !== 1) return { kind: "absent", citations: [] };
  const invalid: AcpCitationPresentation = { kind: "invalid", citations: [] };
  if (
    contract.offset_unit !== "unicode-code-points" ||
    !Array.isArray(contract.annotations) ||
    !Array.isArray(contract.bindings) ||
    !["complete", "partial"].includes(String(contract.processing))
  )
    return invalid;
  const sources = new Map<string, string>();
  for (const content of block.content ?? []) {
    if (content.type !== "resource_link") continue;
    const sourceId = content._meta?.["bunny-agent/sourceId"];
    const uri = safeHttp(content.uri);
    if (typeof sourceId === "string" && uri) {
      if (sources.has(sourceId) && sources.get(sourceId) !== uri) return invalid;
      sources.set(sourceId, uri);
    }
  }
  const offsets = [0];
  for (const point of block.text) offsets.push((offsets.at(-1) ?? 0) + point.length);
  const citations: AcpCitation[] = [];
  for (const [index, raw] of contract.annotations.entries()) {
    const annotation = record(raw);
    const bindings = contract.bindings.filter(
      (binding) => record(binding)?.annotation_index === index,
    );
    const binding = record(bindings[0]);
    const url = safeHttp(annotation?.url);
    const from = annotation?.start_index;
    const to = annotation?.end_index;
    if (
      annotation?.type !== "url_citation" ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      typeof from !== "number" ||
      typeof to !== "number" ||
      from < 0 ||
      to <= from ||
      to >= offsets.length ||
      !url ||
      typeof annotation.title !== "string" ||
      bindings.length !== 1 ||
      typeof binding?.source_id !== "string" ||
      sources.get(binding.source_id) !== url ||
      !["provider", "explicit_source_marker"].includes(String(binding.origin))
    )
      return invalid;
    const start = offsets[from];
    const end = offsets[to];
    citations.push({
      start,
      end,
      url,
      title: annotation.title,
      sourceId: binding.source_id,
      quote: block.text.slice(start, end),
    });
  }
  if (
    contract.bindings.some((binding) => {
      const index = record(binding)?.annotation_index;
      return (
        typeof index !== "number" ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= citations.length
      );
    })
  )
    return invalid;
  citations.sort((left, right) => left.start - right.start || left.end - right.end);
  if (citations.some((citation, index) => index > 0 && citation.start < citations[index - 1].end))
    return invalid;
  return { kind: "valid", citations, partial: contract.processing === "partial" };
}

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** Project links only into parsed prose. Code, existing links and HTML stay unchanged. */
export function citationMarkdown(
  text: string,
  citations: readonly AcpCitation[],
  textOffset = 0,
): string {
  const prose: Array<{ start: number; end: number }> = [];
  const visit = (node: MarkdownNode) => {
    if (["code", "inlineCode", "link", "linkReference", "definition", "html"].includes(node.type))
      return;
    if (node.type === "text") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) prose.push({ start, end });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(text) as MarkdownNode);
  const eligible = citations.flatMap((citation) => {
    const start = citation.start - textOffset;
    const end = citation.end - textOffset;
    return start >= 0 &&
      end <= text.length &&
      prose.some((node) => start >= node.start && end <= node.end) &&
      (text.slice(0, start).match(/\\+$/)?.[0].length ?? 0) % 2 === 0
      ? [{ ...citation, start, end }]
      : [];
  });
  let output = "";
  let cursor = 0;
  for (const citation of eligible) {
    const label = text.slice(citation.start, citation.end).replace(/[\\[\]]/g, "\\$&");
    output += `${text.slice(cursor, citation.start)}[${label}](<${citation.url}>)`;
    cursor = citation.end;
  }
  return output + text.slice(cursor);
}
