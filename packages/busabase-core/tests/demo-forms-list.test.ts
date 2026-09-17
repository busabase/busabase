import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import {
  DEMO_INSURANCE_CLIENTS_BASE_ID,
  DEMO_INSURANCE_POLICIES_BASE_ID,
} from "../src/demo/scenarios/insurance-agency";
import { busabaseDemoRouter } from "../src/router-demo";

/**
 * "Which forms write into this Base" is a READ, and the surface that asks is a
 * safety panel on the Base — so it has to work under `?demo=`, which is a public
 * marketing tour. It used to throw `demoUnsupported("List forms")`, which would
 * have put a red error block on the Design tab of every demo Base.
 */
describe("demo forms.list", () => {
  const client = createRouterClient(busabaseDemoRouter);

  it("returns the seeded forms that write into a Base", async () => {
    const result = await client.forms.list({ targetBaseId: DEMO_INSURANCE_CLIENTS_BASE_ID });
    expect(result.forms.length).toBeGreaterThan(0);
    expect(result.forms.every((form) => form.targetBaseId === DEMO_INSURANCE_CLIENTS_BASE_ID)).toBe(
      true,
    );
    // The whole seeded set fits one page, so there is never a cursor to follow.
    expect(result.nextCursor).toBeNull();
  });

  it("returns an empty page — not an error — for a Base no form writes into", async () => {
    const result = await client.forms.list({ targetBaseId: DEMO_INSURANCE_POLICIES_BASE_ID });
    expect(result.forms).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});
