/**
 * Boundary P13 — folder delete/restore keeps the Base table in lockstep
 *
 * Regression: deleting a folder that contains a Base archived the base NODE but
 * left `busabase_bases.archivedAt` null + its records active — a ghost base that
 * showed in bases.list with no node in the tree. mergeNodeDelete/Restore now
 * archive/restore the base row + records for any Base node in the subtree/batch.
 */
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

async function approveMerge(raw: RawClient, changeRequestId: string) {
  await raw.changeRequests.review({ changeRequestId, verdict: "approved" });
  await raw.changeRequests.merge({ changeRequestId });
}

function findInTree(
  nodes: Array<{ id: string; slug: string; children: unknown[] }>,
  slug: string,
): { id: string; slug: string } | null {
  for (const n of nodes) {
    if (n.slug === slug) {
      return n;
    }
    const found = findInTree(
      n.children as Array<{ id: string; slug: string; children: unknown[] }>,
      slug,
    );
    if (found) {
      return found;
    }
  }
  return null;
}

describe("Boundary P13 — folder delete keeps Base table in lockstep", () => {
  it("archiving a folder archives its child Base + records; restore brings them back", async () => {
    const { client } = await seedScenario("p13-folder-base");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const folderCr = await raw.nodes.createChangeRequest({
      operations: [{ kind: "create", nodeType: "folder", slug: "proj", name: "Proj" }],
    });
    await approveMerge(raw, folderCr.id);
    const folder = findInTree(await raw.nodes.list(), "proj");
    expect(folder).toBeTruthy();

    const base = await raw.bases.create({ name: "B", slug: "b-proj", parentNodeId: folder?.id });
    await client.records.createChangeRequest({
      baseId: base.id,
      fields: { title: "R1" },
      submittedBy: "alice",
      mergeImmediately: true,
    });
    expect((await raw.bases.list()).some((b) => b.id === base.id)).toBe(true);

    // Delete the folder → its child Base must leave the active list and its
    // records must be archived (not just the base node hidden from the tree).
    const delCr = await raw.nodes.createChangeRequest({
      operations: [{ kind: "delete", nodeId: folder?.id as string }],
    });
    await approveMerge(raw, delCr.id);

    expect((await raw.bases.list()).some((b) => b.id === base.id)).toBe(false);
    expect((await raw.bases.listArchived()).some((b) => b.id === base.id)).toBe(true);
    expect((await raw.records.list({})).some((r) => r.baseId === base.id)).toBe(false);

    // Restore the folder → base + records come back active.
    const resCr = await raw.nodes.createChangeRequest({
      operations: [{ kind: "restore", nodeId: folder?.id as string }],
    });
    await approveMerge(raw, resCr.id);

    expect((await raw.bases.list()).some((b) => b.id === base.id)).toBe(true);
    expect((await raw.records.list({})).some((r) => r.baseId === base.id)).toBe(true);
  });
});
