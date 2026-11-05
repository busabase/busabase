import type { FieldType } from "busabase-contract/types";
import { isSystemFieldType } from "../field-types";

/** Read-only values do not make user-configured computed columns permanent. */
export const isDeletableFieldType = (type: FieldType): boolean =>
  type === "lookup" || type === "formula" || !isSystemFieldType(type);
