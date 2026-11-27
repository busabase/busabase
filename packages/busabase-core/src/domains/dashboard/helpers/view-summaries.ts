import {
  type BaseFieldVO,
  getViewSummaryFunctions,
  isViewSummaryFunctionAllowed,
  NUMERIC_AGGREGATE_FIELD_TYPES,
  type ViewConfigVO,
  type ViewSummaryFunction,
} from "busabase-contract/types";
import type { CoreI18nMessages } from "../../../i18n/messages";
import { getFieldPreviewText } from "./field";

export interface ResolvedFieldSummary {
  field: BaseFieldVO;
  fn: ViewSummaryFunction;
}

/** Summary functions offered for a field, in menu order. */
export const getFieldSummaryFunctions = (field: BaseFieldVO): readonly ViewSummaryFunction[] =>
  getViewSummaryFunctions(field.type);

/**
 * The view's footer summaries that still apply, keyed by field slug. Entries
 * whose field was deleted or whose type no longer supports the function are
 * skipped — a saved view outlives the schema it was written against.
 */
export const resolveViewFieldSummaries = (
  config: Pick<ViewConfigVO, "fieldSummaries"> | undefined,
  fields: readonly BaseFieldVO[],
): Map<string, ResolvedFieldSummary> => {
  const resolved = new Map<string, ResolvedFieldSummary>();
  for (const [slug, fn] of Object.entries(config?.fieldSummaries ?? {})) {
    const field = fields.find((candidate) => candidate.slug === slug);
    if (field && isViewSummaryFunctionAllowed(field.type, fn)) resolved.set(slug, { field, fn });
  }
  return resolved;
};

/** One `records.groupBy` aggregate a summary reads. */
export interface SummaryAggregate {
  fn: "sum" | "avg" | "min" | "max" | "count" | "filled" | "checked";
  fieldSlug: string;
}

const isNumeric = (field: BaseFieldVO) => NUMERIC_AGGREGATE_FIELD_TYPES.has(field.type);

/**
 * The aggregate a summary is computed from. On a number field the filled
 * family reads `count` (present values, a single SQL aggregate); elsewhere it
 * reads `filled`, the `not_empty` filter's own test. The checked family reads
 * `checked`, the `is_true` filter's own test.
 */
export const summaryAggregateFor = ({ field, fn }: ResolvedFieldSummary): SummaryAggregate => {
  if (fn === "sum" || fn === "avg" || fn === "min" || fn === "max") {
    return { fn, fieldSlug: field.slug };
  }
  if (fn === "checked" || fn === "unchecked" || fn === "percent_checked") {
    return { fn: "checked", fieldSlug: field.slug };
  }
  return { fn: isNumeric(field) ? "count" : "filled", fieldSlug: field.slug };
};

const aggregateKey = (aggregate: SummaryAggregate) => `${aggregate.fn}:${aggregate.fieldSlug}`;

/** The deduplicated aggregates a set of summaries needs, in a stable order. */
export const buildSummaryAggregates = (
  summaries: Iterable<ResolvedFieldSummary>,
): SummaryAggregate[] => {
  const byKey = new Map<string, SummaryAggregate>();
  for (const summary of summaries) {
    const aggregate = summaryAggregateFor(summary);
    byKey.set(aggregateKey(aggregate), aggregate);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, aggregate]) => aggregate);
};

export type SummaryValue =
  | { kind: "number"; value: number }
  | { kind: "count"; value: number }
  | { kind: "percent"; value: number }
  /** No value to show: a sum over no numbers, or a percentage of no records. */
  | { kind: "none" };

export interface SummaryBucket {
  count: number;
  aggregates?: Record<string, number | null>;
}

/**
 * A summary's value for one bucket (the whole view, or one group). A missing
 * bucket means no records matched — `records.groupBy` omits empty buckets.
 */
export const computeSummaryValue = (
  summary: ResolvedFieldSummary,
  bucket: SummaryBucket | undefined,
): SummaryValue => {
  const count = bucket?.count ?? 0;
  const raw = bucket?.aggregates?.[aggregateKey(summaryAggregateFor(summary))];
  switch (summary.fn) {
    case "sum":
    case "avg":
    case "min":
    case "max":
      return typeof raw === "number" && Number.isFinite(raw)
        ? { kind: "number", value: raw }
        : { kind: "none" };
    case "filled":
    case "checked":
      return { kind: "count", value: typeof raw === "number" ? raw : 0 };
    case "empty":
    case "unchecked":
      return { kind: "count", value: Math.max(0, count - (typeof raw === "number" ? raw : 0)) };
    case "percent_filled":
    case "percent_checked":
      return count > 0
        ? { kind: "percent", value: (typeof raw === "number" ? raw : 0) / count }
        : { kind: "none" };
  }
};

// Float sums like 0.1 + 0.2 must not print 0.30000000000000004.
const cleanFloat = (value: number) => Number(value.toPrecision(15));

/**
 * Display text for a summary value. Sums, minimums and maximums use the field's
 * own cell formatting (currency included); an average may carry two decimals
 * more than the data. Counts and percentages use the viewer's locale.
 */
export const formatSummaryValue = (
  summary: ResolvedFieldSummary,
  value: SummaryValue,
  locale: string,
  messages?: CoreI18nMessages,
): string => {
  if (value.kind === "none") return "—";
  if (value.kind === "count") return new Intl.NumberFormat(locale).format(value.value);
  if (value.kind === "percent") {
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
      value.value,
    );
  }
  const number = summary.fn === "avg" ? Number(value.value.toFixed(2)) : cleanFloat(value.value);
  if (summary.field.type === "number") {
    const options = summary.field.options.number;
    if (summary.fn === "avg" && options?.format === "currency") {
      return new Intl.NumberFormat(options.locale ?? locale, {
        style: "currency",
        currency: options.currency ?? "USD",
        maximumFractionDigits: 4,
      }).format(value.value);
    }
    return getFieldPreviewText(summary.field, number, messages, locale);
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(number);
};

/**
 * The `fieldSummaries` map after setting (or with `fn` null, removing) one
 * column's summary. Entries that no longer apply are dropped on the way, so a
 * write never carries a stale entry the server would have to reject.
 */
export const setViewFieldSummary = (
  config: Pick<ViewConfigVO, "fieldSummaries"> | undefined,
  fields: readonly BaseFieldVO[],
  fieldSlug: string,
  fn: ViewSummaryFunction | null,
): Record<string, ViewSummaryFunction> => {
  const next: Record<string, ViewSummaryFunction> = {};
  for (const [slug, summary] of resolveViewFieldSummaries(config, fields)) {
    if (slug !== fieldSlug) next[slug] = summary.fn;
  }
  const field = fields.find((candidate) => candidate.slug === fieldSlug);
  if (fn && field && isViewSummaryFunctionAllowed(field.type, fn)) next[fieldSlug] = fn;
  return next;
};
