import type { FieldType } from "busabase-contract/types";
import { FIELD_TYPE_ORDER } from "../../base/field-types";

/**
 * The field-type picker's options, deliberately split out of `./field.ts`.
 *
 * `field.ts` is reached from `helpers/change-request.ts`, which
 * `apps/busabase-mobile` now imports through the package's exports map. This
 * one line was the only thing in `field.ts` that needed `../../base/field-types`
 * — a module that transitively drags ~15 files plus the `yaml` parser and the
 * formula evaluator into whatever bundles it. Keeping it here means the mobile
 * bundle pays for none of that, while the web field editor imports it as before.
 */
export const fieldTypeOptions: FieldType[] = FIELD_TYPE_ORDER;
