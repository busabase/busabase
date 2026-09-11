import { describe, expect, it } from "vitest";

import { updateFieldChangeRequestInputSchema } from "./base-schemas";

describe("updateFieldChangeRequestInputSchema.patch", () => {
  it("rejects a type change instead of silently dropping it", () => {
    const result = updateFieldChangeRequestInputSchema.safeParse({
      fieldId: "fld_1",
      patch: { type: "markdown" },
    });

    // The regression this guards: `patch` is a plain object, so an unknown key
    // used to be stripped. The request validated, the change request merged,
    // `ok: true` came back, and the field kept its old type — a successful
    // no-op that reads exactly like a successful conversion.
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("convert");
  });

  it("points the caller at the operation that does work", () => {
    const result = updateFieldChangeRequestInputSchema.safeParse({
      fieldId: "fld_1",
      patch: { type: "markdown" },
    });

    const message = result.error?.issues.map((issue) => issue.message).join(" ") ?? "";
    expect(message).toContain("previewFieldConversion");
  });

  it("still accepts the keys update is actually for", () => {
    const result = updateFieldChangeRequestInputSchema.safeParse({
      fieldId: "fld_1",
      patch: { name: "Renamed", required: true },
    });

    expect(result.success).toBe(true);
  });

  it("keeps tolerating unknown keys, so a newer client can talk to an older server", () => {
    // `contract/auto-merge.ts` explains why these schemas are not `.strict()`:
    // the SDK ships on its own cadence against self-hosted servers. Only the
    // one key that can never be legitimate is named; everything else still
    // degrades gracefully rather than 400ing.
    const result = updateFieldChangeRequestInputSchema.safeParse({
      fieldId: "fld_1",
      patch: { name: "Renamed", someFutureKey: "from a newer SDK" },
    });

    expect(result.success).toBe(true);
  });
});
