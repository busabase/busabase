/**
 * Boundary P14 — cross-tenant get-by-id is space-scoped
 *
 * Several lookups resolved a record / view / node purely by id, with no spaceId
 * filter — so a leaked/guessed id from another space could be read or targeted by
 * a change request. All such lookups now filter by getContextSpaceId().
 */
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const OTHER = "other-space";

describe("Boundary P14 — cross-tenant get-by-id is space-scoped", () => {
  it("a record/view/doc created in one space is invisible to another space", async () => {
    const { client } = await seedScenario("p14-cross-tenant");
    const raw: RawClient = createRouterClient(busabaseRouter);

    // Everything below is created in the default LOCAL_SPACE_ID space.
    const base = await client.bases.create({ name: "Secret", slug: "secret" });
    const record = await client.records.createChangeRequest({
      baseId: base.id,
      fields: { title: "R1" },
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
    const view = (await raw.bases.listViews({ baseId: base.id }))[0];
    expect(view).toBeTruthy();
    const doc = await raw.docs.create({ slug: "notes", name: "Notes", autoMerge: true });
    if ("status" in doc) throw new Error("Expected materialized DocVO");

    // From a DIFFERENT space, none of these ids resolve.
    await runWithBusabaseContext({ spaceId: OTHER }, async () => {
      await expect(
        raw.records.deleteChangeRequest({ recordId: record.id, submittedBy: "mallory" }),
      ).rejects.toThrow();
      await expect(
        raw.views.deleteChangeRequest({ viewId: view.id, submittedBy: "mallory" }),
      ).rejects.toThrow();
      await expect(raw.docs.get({ nodeId: doc.node.id })).rejects.toThrow(/not found/i);
    });

    // Sanity: the owning space still resolves them fine.
    await runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID }, async () => {
      const fetched = await raw.docs.get({ nodeId: doc.node.id });
      expect(fetched.node.id).toBe(doc.node.id);
    });
  });
});
