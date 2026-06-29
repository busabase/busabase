/**
 * Boundary P15 — archiving a base hides its records + views (no ghosts)
 *
 * Regression: base_archive (the UI "archive base" path) only set
 * busabase_bases.archivedAt + the node, leaving records status="active" and views
 * active — so they leaked into the global records.list / search / listViews while
 * the base itself was hidden. mergeBaseArchive/Restore now archive/restore the
 * base's records + views in lockstep (matching the node-delete path).
 */
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Boundary P15 — base archive hides records + views", () => {
  it("archiving a base removes its records/views from listings; restore brings them back", async () => {
    const { client } = await seedScenario("p15-base-archive-records");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const base = await client.bases.create({ name: "Sales", slug: "sales" });
    const record = await client.records.createChangeRequest({
      baseId: base.id,
      fields: { title: "Deal" },
      submittedBy: "alice",
      mergeImmediately: true,
    });
    await client.bases.createViewChangeRequest({
      baseId: base.id,
      name: "Grid",
      config: {},
      submittedBy: "alice",
      mergeImmediately: true,
    });
    expect((await raw.records.list({})).some((r) => r.id === record.id)).toBe(true);
    expect((await raw.bases.listViews({ baseId: base.id })).length).toBe(1);
    expect((await raw.search({ query: "sales" })).results.some((x) => x.kind === "base")).toBe(
      true,
    );

    // Archive the base (the UI archive path: base_archive).
    await client.bases.createArchiveChangeRequest({
      baseId: base.id,
      submittedBy: "alice",
      mergeImmediately: true,
    });

    expect((await raw.records.list({})).some((r) => r.id === record.id)).toBe(false);
    expect((await raw.bases.listViews({ baseId: base.id })).length).toBe(0);
    expect((await raw.search({ query: "sales" })).results.some((x) => x.kind === "base")).toBe(
      false,
    );

    // Restore the base → records + views come back.
    const restoreCr = await raw.bases.restoreChangeRequest({
      baseId: base.id,
      submittedBy: "alice",
    });
    await raw.changeRequests.review({ changeRequestId: restoreCr.id, verdict: "approved" });
    await raw.changeRequests.merge({ changeRequestId: restoreCr.id });

    expect((await raw.records.list({})).some((r) => r.id === record.id)).toBe(true);
    expect((await raw.bases.listViews({ baseId: base.id })).length).toBe(1);
  });
});
