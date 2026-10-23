import type { BaseFieldVO, LookupRollup } from "busabase-contract/types";
import { rollupPreservesTargetUnit } from "../../base/lookup/rollup";

type LookupConfig = {
  relationFieldSlug: string;
  targetFieldSlug: string;
  rollup?: LookupRollup;
  limit?: "all" | "first";
};

export const sameLookupConfig = (left: LookupConfig | undefined, right: LookupConfig) =>
  Boolean(
    left &&
      left.relationFieldSlug === right.relationFieldSlug &&
      left.targetFieldSlug === right.targetFieldSlug &&
      (left.rollup ?? "values") === (right.rollup ?? "values") &&
      (left.limit ?? "all") === (right.limit ?? "all"),
  );

export const lookupDisplayField = (target: BaseFieldVO, rollup: LookupRollup): BaseFieldVO =>
  rollup === "values"
    ? target
    : {
        ...target,
        type: rollup === "concatenate" ? "text" : "number",
        options: rollupPreservesTargetUnit(rollup) ? target.options : {},
      };

export const lookupItemValue = (target: BaseFieldVO, value: unknown) =>
  ["multiselect", "member", "attachment", "ai_tags", "relation"].includes(target.type)
    ? [value]
    : value;

export const emptyLookupValues = (values: unknown[]) =>
  values.every(
    (value) =>
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0),
  );
