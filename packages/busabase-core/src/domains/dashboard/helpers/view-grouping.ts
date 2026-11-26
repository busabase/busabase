import type { listRecordsFilterSchema } from "busabase-contract/domains/base/contract/record-schemas";
import {
  type BaseFieldVO,
  GROUPABLE_FIELD_TYPES,
  type ViewGroupByVO,
  type ViewVO,
} from "busabase-contract/types";
import type { z } from "zod";

/** A table view's grouping, resolved against the Base's current fields. */
export interface ResolvedViewGrouping {
  field: BaseFieldVO;
  direction: "asc" | "desc";
}

/** The fields a table view can group by (select and checkbox). */
export const getGroupableFields = (fields: readonly BaseFieldVO[]): BaseFieldVO[] =>
  fields.filter((field) => GROUPABLE_FIELD_TYPES.has(field.type));

/**
 * The grouping a table view should render, or null for the ordinary grid. A
 * saved grouping whose field was deleted or changed type is ignored rather than
 * breaking the grid. A stored field id is authoritative: a reused slug must not
 * silently regroup the table by a different field.
 */
export const resolveViewGrouping = (
  view: Pick<ViewVO, "type" | "config"> | null | undefined,
  fields: readonly BaseFieldVO[],
): ResolvedViewGrouping | null => {
  if (!view || view.type !== "table") return null;
  const level = view.config.groupBy?.[0];
  if (!level?.fieldSlug) return null;
  const field = level.fieldId
    ? fields.find((candidate) => candidate.id === level.fieldId)
    : fields.find((candidate) => candidate.slug === level.fieldSlug);
  if (!field || !GROUPABLE_FIELD_TYPES.has(field.type)) return null;
  return { field, direction: level.direction === "desc" ? "desc" : "asc" };
};

/** The single-level config a group picker writes. */
export const buildViewGroupBy = (
  field: BaseFieldVO | null,
  direction: "asc" | "desc",
): ViewGroupByVO[] => (field ? [{ fieldSlug: field.slug, fieldId: field.id, direction }] : []);

export type GridGroupKey = string | null;

export interface GridGroupBucket {
  /** The `records.groupBy` bucket key: a choice id, "true"/"false", or null. */
  key: GridGroupKey;
  /** Stable string id for React keys and collapse state. */
  id: string;
  kind: "choice" | "unknown" | "empty" | "checked" | "unchecked";
  count: number;
  aggregates?: Record<string, number | null>;
  choice?: { id: string; name: string; color?: string };
}

const EMPTY_GROUP_ID = "__empty__";

export const gridGroupId = (key: GridGroupKey): string => key ?? EMPTY_GROUP_ID;

interface GroupResponseBucket {
  value: string | number | boolean | null;
  count: number;
  aggregates?: Record<string, number | null>;
}

/**
 * `records.groupBy` buckets in display order, empty buckets dropped. A select
 * follows its choice order (`desc` reverses it); choice ids the field no longer
 * lists follow, and the no-value bucket is always last. A checkbox shows
 * unchecked before checked (`desc` reverses it).
 */
export const orderGridGroups = (
  grouping: ResolvedViewGrouping,
  groups: readonly GroupResponseBucket[],
): GridGroupBucket[] => {
  const present = groups.filter((group) => group.count > 0);
  const find = (key: GridGroupKey) =>
    present.find((group) => (group.value === null ? null : String(group.value)) === key);
  const bucket = (
    key: GridGroupKey,
    kind: GridGroupBucket["kind"],
    choice?: GridGroupBucket["choice"],
  ): GridGroupBucket[] => {
    const group = find(key);
    if (!group) return [];
    return [
      {
        key,
        id: gridGroupId(key),
        kind,
        count: group.count,
        ...(group.aggregates ? { aggregates: group.aggregates } : {}),
        ...(choice ? { choice } : {}),
      },
    ];
  };
  if (grouping.field.type === "checkbox") {
    const order = grouping.direction === "desc" ? ["true", "false"] : ["false", "true"];
    return order.flatMap((key) => bucket(key, key === "true" ? "checked" : "unchecked"));
  }
  const choices = grouping.field.options.choices ?? [];
  const ordered = grouping.direction === "desc" ? [...choices].reverse() : choices;
  const known = new Set(choices.map((choice) => choice.id));
  const unknown = present
    .map((group) => (group.value === null ? null : String(group.value)))
    .filter((key): key is string => key !== null && !known.has(key))
    .sort((left, right) => left.localeCompare(right));
  return [
    ...ordered.flatMap((choice) => bucket(choice.id, "choice", choice)),
    ...unknown.flatMap((key) => bucket(key, "unknown")),
    ...bucket(null, "empty"),
  ];
};

export type GridGroupFilter = z.input<typeof listRecordsFilterSchema>;

/**
 * The `records.listPage` filter that pages exactly one bucket's records. These
 * are the same operators a Kanban column uses, and they bucket the way
 * `records.groupBy` does: an unset checkbox is `is_false`, an unset or blank
 * select is `is_empty`.
 */
export const gridGroupFilter = (field: BaseFieldVO, key: GridGroupKey): GridGroupFilter => {
  if (field.type === "checkbox") {
    return {
      fieldSlug: field.slug,
      fieldType: "checkbox",
      operator: key === "true" ? "is_true" : "is_false",
    };
  }
  return key === null
    ? { fieldSlug: field.slug, fieldType: field.type, operator: "is_empty" }
    : { fieldSlug: field.slug, fieldType: field.type, operator: "equals", value: key };
};
