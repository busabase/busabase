/**
 * Boundary P9 — node soft-delete + restore (folder / doc / skill)
 *
 * Non-base node deletion used to hard-delete (cascade). It now soft-archives so
 * the deletion is recoverable: archived nodes leave their listings + the tree,
 * surface in nodes.listArchived, and node_restore brings them back. Folders
 * archive/restore their whole subtree as one batch; reused slugs block restore.
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

async function deleteNode(raw: RawClient, nodeId: string) {
  const cr = await raw.nodes.createChangeRequest({ operations: [{ kind: "delete", nodeId }] });
  await approveMerge(raw, cr.id);
}

async function restoreNode(raw: RawClient, nodeId: string) {
  const cr = await raw.nodes.createChangeRequest({ operations: [{ kind: "restore", nodeId }] });
  return approveMerge(raw, cr.id);
}

const flatten = (nodes: Array<{ slug: string; children: unknown[] }>): string[] =>
  nodes.flatMap((n) => [n.slug, ...flatten(n.children as Array<{ slug: string; children: [] }>)]);

describe("Boundary P9 — node soft-delete + restore", () => {
  it("Fix 1: deleting a doc soft-archives it (recoverable via restore)", async () => {
    await seedScenario("p9-doc-soft-delete");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const doc = await raw.docs.create({ slug: "note", name: "Note" });
    await deleteNode(raw, doc.node.id);

    expect((await raw.docs.list()).some((d) => d.node.id === doc.node.id)).toBe(false);
    const archived = await raw.nodes.listArchived();
    expect(archived.some((n) => n.id === doc.node.id)).toBe(true);

    await restoreNode(raw, doc.node.id);
    expect((await raw.docs.list()).some((d) => d.node.id === doc.node.id)).toBe(true);
    expect((await raw.nodes.listArchived()).some((n) => n.id === doc.node.id)).toBe(false);
  });

  it("Fix 2: deleting a folder archives its subtree; restore brings it all back", async () => {
    await seedScenario("p9-folder-subtree");
    const raw: RawClient = createRouterClient(busabaseRouter);

    // folder "team" with a child doc "team/charter".
    const folderCr = await raw.nodes.createChangeRequest({
      operations: [{ kind: "create", nodeType: "folder", slug: "team", name: "Team" }],
    });
    await approveMerge(raw, folderCr.id);
    const folder = flattenFind(await raw.nodes.list(), "team");
    expect(folder).toBeTruthy();
    const childDoc = await raw.docs.create({
      slug: "charter",
      name: "Charter",
      parentNodeId: folder?.id,
    });

    await deleteNode(raw, folder?.id as string);

    // Both the folder and its child doc leave the tree + doc listing.
    expect(flatten(await raw.nodes.list())).not.toContain("team");
    expect((await raw.docs.list()).some((d) => d.node.id === childDoc.node.id)).toBe(false);

    // Restoring the folder restores the whole batch (folder + child doc).
    await restoreNode(raw, folder?.id as string);
    expect(flatten(await raw.nodes.list())).toContain("team");
    expect((await raw.docs.list()).some((d) => d.node.id === childDoc.node.id)).toBe(true);
  });

  it("Fix 3: an archived node's slug is reusable; restoring it then conflicts", async () => {
    await seedScenario("p9-slug-reuse");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const first = await raw.docs.create({ slug: "spec", name: "Spec" });
    await deleteNode(raw, first.node.id);

    // Slug freed → a new doc can take "spec".
    const second = await raw.docs.create({ slug: "spec", name: "Spec v2" });
    expect(second.node.id).not.toBe(first.node.id);

    // Restoring the original now collides with the active sibling → CONFLICT.
    await expect(restoreNode(raw, first.node.id)).rejects.toThrow(/slug .* is now used|Rename it/i);
  });
});

function flattenFind(
  nodes: Array<{ id: string; slug: string; children: unknown[] }>,
  slug: string,
): { id: string; slug: string } | null {
  for (const n of nodes) {
    if (n.slug === slug) {
      return n;
    }
    const found = flattenFind(
      n.children as Array<{ id: string; slug: string; children: unknown[] }>,
      slug,
    );
    if (found) {
      return found;
    }
  }
  return null;
}
