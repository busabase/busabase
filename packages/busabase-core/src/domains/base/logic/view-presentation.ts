import "server-only";

import { ORPCError } from "@orpc/server";
import {
  type BaseFieldVO,
  FILLED_VIEW_SUMMARY_FUNCTIONS,
  GROUPABLE_FIELD_TYPES,
  getViewSummaryFunctions,
  isViewSummaryFunctionAllowed,
  type ViewConfigVO,
} from "busabase-contract/types";

/**
 * Write-time checks for the table presentation keys that name fields: a group
 * must be a field of this Base that can be grouped, and a summary must be one
 * its field's type supports. Only the keys the caller SUPPLIED are checked — an
 * unrelated patch (a rename, a row height) must never be refused because the
 * Base changed under a saved setting; readers already ignore stale entries.
 *
 * A filled-family summary naming a field that does not exist yet is kept: a
 * template install creates its views before its relation and lookup fields,
 * and the entry starts applying once the field is there. Numeric and checkbox
 * summaries need their (plain, created-first) field now, since nothing created
 * later could make an unknown field summable or checkable.
 */
export const assertViewPresentationConfig = (
  fields: ReadonlyArray<BaseFieldVO>,
  config: Pick<ViewConfigVO, "groupBy" | "fieldSummaries"> | undefined,
): void => {
  if (!config) return;
  for (const level of config.groupBy ?? []) {
    const field = level.fieldId
      ? fields.find((candidate) => candidate.id === level.fieldId)
      : fields.find((candidate) => candidate.slug === level.fieldSlug);
    if (!field) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Cannot group by "${level.fieldSlug}": no such field in this Base.`,
      });
    }
    if (!GROUPABLE_FIELD_TYPES.has(field.type)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Cannot group by a ${field.type} field: ${field.slug}. A table can group by: ${[...GROUPABLE_FIELD_TYPES].join(", ")}.`,
      });
    }
  }
  for (const [slug, fn] of Object.entries(config.fieldSummaries ?? {})) {
    const field = fields.find((candidate) => candidate.slug === slug);
    if (!field) {
      if (!FILLED_VIEW_SUMMARY_FUNCTIONS.includes(fn)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Cannot summarize "${slug}" with ${fn}: no such field in this Base.`,
        });
      }
      continue;
    }
    if (!isViewSummaryFunctionAllowed(field.type, fn)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Cannot summarize a ${field.type} field with ${fn}: ${slug}. Supported for ${field.type}: ${getViewSummaryFunctions(field.type).join(", ") || "none"}.`,
      });
    }
  }
};
