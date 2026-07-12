/**
 * Boundary P12 — Trash permanent delete (purge)
 *
 * Archived nodes (folder/doc/skill AND Base) can be permanently removed from
 * the Trash. Purge is refused unless the node is archived, and — since the
 * unified soft-delete rework — is now a SOFT delete for every node type: the
 * row (and a Base's `busabase_bases` row, kept in lockstep via its 1:1
 * `nodeId`) is stamped with `deletedAt` and kept forever, just hidden from
 * every list/tree/search query. This sidesteps the commit history's
 * FK-restrict on `busabase_bases` that made a hard delete impossible for a
 * Base subtree, so a subtree containing a Base is now ALLOWED (it used to be
 * refused — see the old Fix 3 below, replaced).
 */
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { describe, expect, it } from "vitest";
import { docBodyKey } from "../src/domains/doc/handlers";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

async function approveMerge(raw: RawClient, changeRequestId: string) {
  await raw.changeRequests.review({ changeRequestId, verdict: "approved" });
  await raw.changeRequests.merge({ changeRequestId });
}

async function deleteNode(raw: RawClient, nodeId: string) {
  const cr = await raw.nodes.createChangeRequest({ operations: [{ kind: "delete", nodeId }] });
  await approveMerge(raw, cr.id);
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

describe("Boundary P12 — Trash permanent delete (purge)", () => {
  it("Fix 1: purging an archived doc soft-deletes it — hidden everywhere, row kept", async () => {
    await seedScenario("p12-purge-doc");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const doc = await raw.docs.create({ slug: "tmp", name: "Tmp", autoMerge: true });
    if ("status" in doc) throw new Error("Expected materialized DocVO");
    await deleteNode(raw, doc.node.id);
    expect((await raw.nodes.listArchived()).some((n) => n.id === doc.node.id)).toBe(true);

    const res = await raw.nodes.purge({ nodeId: doc.node.id });
    expect(res.purged).toBe(true);
    expect((await raw.nodes.listArchived()).some((n) => n.id === doc.node.id)).toBe(false);
    expect((await raw.nodes.list()).some((n) => n.id === doc.node.id)).toBe(false);

    // A second purge attempt hits the "already permanently deleted" guard
    // instead of NOT_FOUND — proving the row is still there (soft delete),
    // never a real `db.delete()`.
    await expect(raw.nodes.purge({ nodeId: doc.node.id })).rejects.toThrow(
      /already permanently deleted/i,
    );
  });

  it("Fix 2: cannot purge a node that is not archived", async () => {
    await seedScenario("p12-purge-active");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const doc = await raw.docs.create({ slug: "live", name: "Live", autoMerge: true });
    if ("status" in doc) throw new Error("Expected materialized DocVO");
    await expect(raw.nodes.purge({ nodeId: doc.node.id })).rejects.toThrow(/archived items/i);
  });

  it("Fix 3: purging a folder that contains a Base soft-deletes the Base in lockstep", async () => {
    await seedScenario("p12-purge-folder-base");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const folderCr = await raw.nodes.createChangeRequest({
      operations: [{ kind: "create", nodeType: "folder", slug: "proj", name: "Proj" }],
    });
    await approveMerge(raw, folderCr.id);
    const folder = findInTree(await raw.nodes.list(), "proj");
    expect(folder).toBeTruthy();
    const base = await raw.bases.create({
      name: "B",
      slug: "b-in-proj",
      parentNodeId: folder?.id,
      autoMerge: true,
    });

    await deleteNode(raw, folder?.id as string);
    expect((await raw.bases.listArchived()).some((b) => b.id === base.id)).toBe(true);

    // Previously refused (FK-restrict on commits blocked a hard delete of the
    // Base row); now allowed since purge never physically deletes anything.
    const res = await raw.nodes.purge({ nodeId: folder?.id as string });
    expect(res.purged).toBe(true);
    expect((await raw.nodes.listArchived()).some((n) => n.id === folder?.id)).toBe(false);
    expect((await raw.bases.listArchived()).some((b) => b.id === base.id)).toBe(false);
    expect((await raw.bases.list()).some((b) => b.id === base.id)).toBe(false);
  });

  it("Fix 4: purging a Base directly soft-deletes it and permanently blocks restore", async () => {
    await seedScenario("p12-purge-base-direct");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const base = await raw.bases.create({ name: "Direct", slug: "direct-base", autoMerge: true });
    await deleteNode(raw, base.nodeId);
    expect((await raw.bases.listArchived()).some((b) => b.id === base.id)).toBe(true);

    const res = await raw.nodes.purge({ nodeId: base.nodeId });
    expect(res.purged).toBe(true);
    expect((await raw.bases.listArchived()).some((b) => b.id === base.id)).toBe(false);
    expect((await raw.bases.list()).some((b) => b.id === base.id)).toBe(false);

    // A purged Base is a terminal state — restore must be rejected even though
    // it went through the archive step first (unlike a plain archived base).
    await expect(raw.bases.restoreChangeRequest({ baseId: base.id })).rejects.toThrow(
      /permanently deleted/i,
    );
  });

  it("Fix 5: purging a Doc frees its body object in storage — but soft-delete (archive) alone does not", async () => {
    await seedScenario("p12-purge-doc-storage");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const doc = await raw.docs.create({ slug: "leaky", name: "Leaky", autoMerge: true });
    if ("status" in doc) throw new Error("Expected materialized DocVO");
    await raw.docs.updateBody({ nodeId: doc.node.id, body: "some real content" });
    expect(await storage.objectExists(docBodyKey(doc.node.id))).toBe(true);

    await deleteNode(raw, doc.node.id);
    // Soft-delete (archive, recoverable via restore) must NOT touch storage —
    // otherwise restoring the doc would come back with an empty body.
    expect(await storage.objectExists(docBodyKey(doc.node.id))).toBe(true);

    const res = await raw.nodes.purge({ nodeId: doc.node.id });
    expect(res.purged).toBe(true);
    // Purge is the one point genuinely never reachable again — the body
    // object must be freed (it already survives forever in commit history).
    expect(await storage.objectExists(docBodyKey(doc.node.id))).toBe(false);
  });
});
