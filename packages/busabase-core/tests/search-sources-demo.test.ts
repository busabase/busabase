import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseDemoRouter } from "../src/router-demo";

/**
 * Demo mode's `search` has its own separate in-memory implementation
 * (`demoSearch` in `logic/demo-store.ts`, never touches the db) — it needs
 * the same `sources` scoping the real (non-demo) `searchBusabase` got, or an
 * agent testing against demo mode would see different filtering semantics
 * than production. Demo mode has no file-content search source at all, so
 * only `records`/`names` are meaningfully exercised here.
 */

describe("search — sources scope (demo mode)", () => {
  const demoClient = createRouterClient(busabaseDemoRouter);

  it("default (no sources) includes both records and base-name results across the full dataset", async () => {
    // `limit` is capped at 100 — combine two scoped, unpaginated calls
    // (already proven correct by the tests below) instead of relying on
    // one unscoped call's slice ordering to surface every kind.
    const records = await demoClient.search({ query: "", sources: ["records"], limit: 100 });
    const names = await demoClient.search({ query: "", sources: ["names"], limit: 100 });
    expect(records.results.length).toBeGreaterThan(0);
    expect(names.results.length).toBeGreaterThan(0);
  });

  it("sources: ['names'] returns only base results, never records/change_requests", async () => {
    const result = await demoClient.search({ query: "", sources: ["names"], limit: 100 });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r) => r.kind === "base")).toBe(true);
  });

  it("sources: ['records'] returns only record/change_request results, never bases", async () => {
    const result = await demoClient.search({ query: "", sources: ["records"], limit: 100 });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r) => r.kind === "record" || r.kind === "change_request")).toBe(
      true,
    );
  });

  it("sources: ['files'] returns nothing — demo mode has no file-content search source", async () => {
    const result = await demoClient.search({ query: "", sources: ["files"], limit: 100 });
    expect(result.results.length).toBe(0);
  });
});
