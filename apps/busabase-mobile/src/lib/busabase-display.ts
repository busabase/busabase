import { OPERATION_META } from "busabase-contract/domains";
import type { BaseFieldVO, ChangeRequestVO, RecordVO } from "busabase-contract/types";

export interface FieldDisplayItem {
  slug: string;
  label: string;
  value: string;
}

const titleSlugs = ["title", "name", "headline", "subject"];
const bodySlugs = ["body", "content", "summary", "description"];

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
      label: definitionBySlug.get(slug)?.name ?? slug,
      value: stringifyFieldValue(fields[slug]),
    }))
    .filter((item) => item.value.length > 0);
}

export function getPrimaryTitle(fields: Record<string, unknown>, fallback: string) {
  for (const slug of titleSlugs) {
    const value = stringifyFieldValue(fields[slug]).trim();
    if (value) {
      return value;
    }
  }

  const firstText = Object.values(fields)
    .map((value) => stringifyFieldValue(value).trim())
    .find(Boolean);

  return firstText ?? fallback;
}

export function getPreview(fields: Record<string, unknown>) {
  for (const slug of bodySlugs) {
    const value = stringifyFieldValue(fields[slug]).trim();
    if (value) {
      return truncate(value, 140);
    }
  }

  const firstText = Object.values(fields)
    .map((value) => stringifyFieldValue(value).trim())
    .find((value) => value.length > 24);

  return firstText ? truncate(firstText, 140) : "No preview fields yet.";
}

/** A change request now targets a base OR a node tree (folders/skills); resolve a display name. */
export function getChangeRequestScopeName(changeRequest: ChangeRequestVO) {
  return changeRequest.base?.name ?? changeRequest.node?.name ?? "Node tree";
}

// Conventional-commit-style title, mirroring the web dashboard helper:
// "<operation verb> <subject>" where the subject is the base's PRIMARY field
// (first by position) value, falling back to title-ish slug guesses.
export function getChangeRequestTitle(changeRequest: ChangeRequestVO) {
  const operation = changeRequest.primaryOperation;
  const fallback = `Change Request ${changeRequest.id.slice(0, 8)}`;
  if (!operation) {
    return fallback;
  }
  if (changeRequest.operationCount > 1) {
    return `${changeRequest.operationCount} operation change request`;
  }

  const primaryField = changeRequest.base?.fields[0];
  const primaryValue =
    primaryField && operation.operation.startsWith("record_")
      ? stringifyFieldValue(
          operation.headCommit.fields[primaryField.slug] ??
            operation.baseFields?.[primaryField.slug],
        ).trim()
      : "";
  const subject = primaryValue || getPrimaryTitle(operation.headCommit.fields, "").trim();
  if (!subject) {
    return fallback;
  }

  const label = operationLabels[operation.operation];
  return label ? `${label} ${subject}` : subject;
}

export function getRecordTitle(record: RecordVO) {
  return getPrimaryTitle(record.headCommit.fields, `Record ${record.id.slice(0, 8)}`);
}

// Operation labels come from the shared node-type registry (single source of truth).
export const operationLabels: Record<string, string> = Object.fromEntries(
  Object.entries(OPERATION_META).map(([kind, meta]) => [kind, meta.label]),
);

export function getOperationSummary(changeRequest: ChangeRequestVO) {
  const counts = new Map<string, number>();
  for (const operation of changeRequest.operations) {
    counts.set(operation.operation, (counts.get(operation.operation) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(
    ([kind, count]) => `${count} ${(operationLabels[kind] ?? kind).toLowerCase()}`,
  );
  return parts.length > 0
    ? parts.join(" · ")
    : `${changeRequest.operationCount} item${changeRequest.operationCount === 1 ? "" : "s"}`;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
