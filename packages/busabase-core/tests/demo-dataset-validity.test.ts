import { describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_RECORDS } from "../src/demo/dataset";
import { validateRecordFields } from "../src/domains/base/field-rules";
import type { FieldDef } from "../src/domains/base/field-types";

/**
 * The demo dataset must satisfy its own field definitions.
 *
 * `applySeedScenario` writes seed records straight to the database, so it never
 * runs `validateRecordFields` — the same rule every real write goes through
 * (`assertValidRecordFields` in domains/base/logic/record-ops.ts). That gap let
 * the dataset accumulate select values that aren't among their field's own
 * `choices`: invisible in the seeded app (reads don't re-validate), but an
 * instant `400 Invalid field value` for anything that replays the demo through
 * the public API — which is exactly what `busabase-cli install` does, and how
 * these were found.
 *
 * Pure and static: no DB, no seeding — just the shipped dataset checked against
 * the shipped validator.
 */
describe("demo dataset is valid against its own field definitions", () => {
  const basesById = new Map(DEMO_BASES.map((base) => [base.id, base]));

  it("every demo base referenced by a record exists", () => {
    const missing = [
      ...new Set(DEMO_RECORDS.filter((r) => !basesById.has(r.baseId)).map((r) => r.baseId)),
    ];
    expect(missing).toEqual([]);
  });

  it("every demo record's field values pass the real validator", () => {
    const failures: string[] = [];
    for (const record of DEMO_RECORDS) {
      const base = basesById.get(record.baseId);
      if (!base) continue;
      // Seed field defs carry no baseId/position; the validator only reads
      // slug/name/type/required/options.
      const defs = base.fields as unknown as ReadonlyArray<FieldDef>;
      for (const error of validateRecordFields(record.fields, defs)) {
        failures.push(`${base.slug}.${error.slug} (record ${record.id}): ${error.message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
