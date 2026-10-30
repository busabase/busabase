import type { ViewConfigVO, ViewVO } from "busabase-contract/types";
import type { ViewFormPayload, ViewUpdatePayload } from "./view-types";

// View settings are JSON values. Ignore object key order and omitted properties,
// while preserving array order, null and explicit empty collections.
const orderedValue = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(orderedValue)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, orderedValue(item)]),
        )
      : value;

const equal = (left: unknown, right: unknown) =>
  JSON.stringify(orderedValue(left)) === JSON.stringify(orderedValue(right));

/** Compare with the editor's opening snapshot, never with refreshed live props. */
export function getViewConfigPatch(
  baseline: ViewConfigVO,
  next: ViewConfigVO,
): Partial<ViewConfigVO> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as Array<keyof ViewConfigVO>) {
    if (next[key] !== undefined && !equal(baseline[key], next[key])) patch[key] = next[key];
  }
  // An explicit policy change is one operation with its accompanying snapshot.
  // Also retain an explicit unchanged policy when changing an allowlist: older
  // API clients omit the flag, which the server intentionally treats as manual.
  const policyChanged = patch.autoShowNewFields !== undefined;
  if (policyChanged || patch.visibleFieldSlugs !== undefined) {
    for (const key of [
      "autoShowNewFields",
      ...(policyChanged ? ["visibleFieldSlugs", "hiddenFieldSlugs", "fieldOrderSlugs"] : []),
    ] as Array<keyof ViewConfigVO>) {
      if (next[key] !== undefined) patch[key] = next[key];
    }
  }
  return patch as Partial<ViewConfigVO>;
}

export function getViewUpdatePayload(baseline: ViewVO, next: ViewFormPayload): ViewUpdatePayload {
  // The edit form renders omitted presentation settings with these defaults.
  // Saving only its name must not turn those display defaults into edits.
  const defaults =
    baseline.type === "gallery"
      ? {
          coverFieldSlug:
            baseline.config.coverFieldSlug === undefined ? "" : baseline.config.coverFieldSlug,
          coverFit: baseline.config.coverFit ?? ("cover" as const),
          cardSize: baseline.config.cardSize ?? ("medium" as const),
          showFieldLabels: baseline.config.showFieldLabels ?? false,
        }
      : baseline.type === "kanban"
        ? {
            coverFieldSlug: baseline.config.coverFieldSlug || null,
            coverFit: baseline.config.coverFit ?? ("cover" as const),
            stackByFieldSlug: baseline.config.stackByFieldSlug ?? null,
            showFieldLabels: baseline.config.showFieldLabels ?? true,
          }
        : baseline.type === "calendar"
          ? { dateFieldSlug: baseline.config.dateFieldSlug ?? null }
          : baseline.type === "gantt"
            ? {
                startFieldSlug: baseline.config.startFieldSlug ?? null,
                endFieldSlug: baseline.config.endFieldSlug ?? null,
                ganttScale: baseline.config.ganttScale ?? ("month" as const),
              }
            : {};
  const config = next.config
    ? getViewConfigPatch({ ...baseline.config, ...defaults }, next.config)
    : {};
  return {
    ...(Object.keys(config).length ? { config } : {}),
    ...(next.name !== baseline.name ? { name: next.name } : {}),
    ...(next.description !== undefined && next.description !== baseline.description
      ? { description: next.description }
      : {}),
    ...(next.type !== undefined && next.type !== baseline.type ? { type: next.type } : {}),
    ...(next.message !== undefined ? { message: next.message } : {}),
    ...(next.submittedBy !== undefined ? { submittedBy: next.submittedBy } : {}),
  };
}
