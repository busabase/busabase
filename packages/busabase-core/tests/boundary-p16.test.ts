/**
 * Boundary P16 — merge-engine state guards for node + view operations
 *
 * Node operations are NOT covered by the "cannot merge into an archived base"
 * guard (node CRs have no baseId), so node_rename / node_move could mutate an
 * archived node. And view_restore skipped the active-state validation, so it
 * could "restore" an already-active view. Both now throw CONFLICT.
 */
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

async function approveMerge(raw: RawClient, changeRequestId: string) {
  await raw.changeRequests.review({ changeRequestId, verdict: "approved" });
  return raw.changeRequests.merge({ changeRequestId });
}

describe("Boundary P16 — node/view merge state guards", () => {
  it("Fix 1: renaming an archived node is rejected", async () => {
    await seedScenario("p16-rename-archived");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const doc = await raw.docs.create({ slug: "draft", name: "Draft" });
    // Archive the doc.
    await approveMerge(
      raw,
      (
        await raw.nodes.createChangeRequest({
          operations: [{ kind: "delete", nodeId: doc.node.id }],
        })
      ).id,
    );

    // A rename CR targeting the now-archived node must not merge.
    const renameCr = await raw.nodes.createChangeRequest({
      operations: [{ kind: "rename", nodeId: doc.node.id, name: "Renamed" }],
    });
    await raw.changeRequests.review({ changeRequestId: renameCr.id, verdict: "approved" });
    await expect(raw.changeRequests.merge({ changeRequestId: renameCr.id })).rejects.toThrow(
      /archived node/i,
    );
  });

  it("Fix 2: restoring a view that is not archived is rejected", async () => {
    const { client } = await seedScenario("p16-restore-active-view");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const base = await client.bases.create({ name: "B", slug: "b" });
    await client.bases.createViewChangeRequest({
      baseId: base.id,
      name: "Grid",
      config: {},
      submittedBy: "alice",
      mergeImmediately: true,
    });
    const view = (await raw.bases.listViews({ baseId: base.id }))[0];
    expect(view).toBeTruthy();

    // The view is active — restoring it is nonsensical and is rejected at the
    // change-request boundary (the merge handler keeps a matching guard as
    // defense-in-depth, mirroring record_restore).
    await expect(
      raw.views.restoreChangeRequest({ viewId: view.id, submittedBy: "alice" }),
    ).rejects.toThrow(/not archived/i);
  });
});
