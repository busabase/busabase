import { OPERATION_META } from "busabase-contract/domains";
import type { BaseFieldVO, ChangeRequestVO, OperationVO } from "busabase-contract/types";
import { getChangeRequestReviewMessage } from "busabase-core/dashboard/change-request";
import { iStringParse } from "openlib/i18n/i-string";

export interface FieldDisplayItem {
  slug: string;
  label: string;
  value: string;
}

const titleSlugs = ["title", "name", "headline", "subject"];
const bodySlugs = ["body", "content", "summary", "description"];
const previewCandidateSlugs = [...titleSlugs, ...bodySlugs, "text", "value", "label"];

interface PreviewOptions {
  maxLength?: number;
  fallback?: string;
}

export function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item): string => stringifyFieldValue(item))
      .filter(Boolean)
      .join(", ");
  }
  return JSON.stringify(value);
}

export function getFieldItems(
  fields: Record<string, unknown>,
  definitions: BaseFieldVO[] = [],
): FieldDisplayItem[] {
  const definitionBySlug = new Map(definitions.map((definition) => [definition.slug, definition]));
  const orderedSlugs = [
    ...definitions.map((definition) => definition.slug),
    ...Object.keys(fields).filter((slug) => !definitionBySlug.has(slug)),
  ];

  return orderedSlugs
    .map((slug) => ({
      slug,
      label: iStringParse(definitionBySlug.get(slug)?.name ?? slug),
      value: stringifyFieldValue(fields[slug]),
    }))
    .filter((item) => item.value.length > 0);
}

export function getPrimaryTitle(fields: Record<string, unknown>, fallback: string) {
  for (const slug of titleSlugs) {
    const value = toDisplayText(fields[slug]);
    if (value) {
      return value;
    }
  }

  const firstText = Object.values(fields)
    .map((value) => toDisplayText(value))
    .find(Boolean);

  return firstText ?? fallback;
}

export function getPreview(fields: Record<string, unknown>, options: PreviewOptions = {}) {
  const maxLength = options.maxLength ?? 112;
  for (const slug of bodySlugs) {
    const value = toDisplayText(fields[slug]);
    if (value) {
      return truncate(value, maxLength);
    }
  }

  const firstText = Object.values(fields)
    .map((value) => toDisplayText(value))
    .find((value) => value.length > 18);

  return firstText
    ? truncate(firstText, maxLength)
    : (options.fallback ?? "No preview fields yet.");
}

// Operation labels come from the shared node-type registry (single source of truth).
export const operationLabels: Record<string, string> = Object.fromEntries(
  Object.entries(OPERATION_META).map(([kind, meta]) => [kind, meta.label]),
);

const operationStatusLabels: Record<OperationVO["status"], string> = {
  archived: "Archived",
  failed: "Failed",
  merged: "Merged",
  pending: "Pending",
};

export function getOperationStatusLabel(status: OperationVO["status"]) {
  return operationStatusLabels[status];
}

/**
 * Review cue for a change request. Delegates to the shared core helper for every
 * status it knows about; `conflict` is the one case core does not special-case
 * (web surfaces conflicts through its own banner instead), and mobile's review
 * sheet has no such banner, so that string stays here.
 */
export function getChangeRequestReviewCue(changeRequest: ChangeRequestVO) {
  if (changeRequest.status === "conflict") {
    return "Conflict · needs revision";
  }
  return getChangeRequestReviewMessage(changeRequest);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function toDisplayText(value: unknown): string {
  return cleanDisplayText(stringifyPreviewValue(value));
}

function stringifyPreviewValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return stringifyFieldValue(value);
  }
  if (Array.isArray(value)) {
    const labels = value
      .map((item): string => stringifyPreviewValue(item))
      .filter(Boolean)
      .slice(0, 4);
    return labels.join(", ");
  }
  if (!isRecord(value)) {
    return "";
  }

  if (typeof value.fileName === "string") {
    return value.fileName;
  }

  for (const slug of previewCandidateSlugs) {
    const text = stringifyPreviewValue(value[slug]);
    if (text) {
      return text;
    }
  }

  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanDisplayText(value: string): string {
  return decodeBasicHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?(br|p|div|li|ul|ol|h[1-6]|article|section|blockquote)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => decodeCodePoint(Number(code)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_match, code: string) =>
      decodeCodePoint(Number.parseInt(code, 16)),
    );
}

function decodeCodePoint(codePoint: number): string {
  if (!Number.isFinite(codePoint)) {
    return "";
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}
