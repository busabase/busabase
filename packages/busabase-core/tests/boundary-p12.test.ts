/**
 * Boundary P12 — Trash permanent delete (purge)
 *
 * Archived folder/doc/skill nodes can be permanently removed from the Trash.
 * Purge is irreversible, refused unless the node is archived, and refused if the
 * subtree contains a Base (commit history is FK-restricted — a separate concern).
 * The delete runs in dependency order (operations → commits → CRs → nodes); these
 * tests actually execute the purge, so a wrong FK order would surface here.
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
  it("Fix 1: purging an archived doc permanently removes it (FK order holds)", async () => {
    await seedScenario("p12-purge-doc");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const doc = await raw.docs.create({ slug: "tmp", name: "Tmp" });
    await deleteNode(raw, doc.node.id);
    expect((await raw.nodes.listArchived()).some((n) => n.id === doc.node.id)).toBe(true);

    const res = await raw.nodes.purge({ nodeId: doc.node.id });
    expect(res.purged).toBe(true);
    expect((await raw.nodes.listArchived()).some((n) => n.id === doc.node.id)).toBe(false);
  });

  it("Fix 2: cannot purge a node that is not archived", async () => {
    await seedScenario("p12-purge-active");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const doc = await raw.docs.create({ slug: "live", name: "Live" });
    await expect(raw.nodes.purge({ nodeId: doc.node.id })).rejects.toThrow(/archived items/i);
  });

  it("Fix 3: cannot purge a folder whose subtree contains a Base", async () => {
    await seedScenario("p12-purge-folder-base");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const folderCr = await raw.nodes.createChangeRequest({
      operations: [{ kind: "create", nodeType: "folder", slug: "proj", name: "Proj" }],
    });
    await approveMerge(raw, folderCr.id);
    const folder = findInTree(await raw.nodes.list(), "proj");
    expect(folder).toBeTruthy();
    await raw.bases.create({ name: "B", slug: "b-in-proj", parentNodeId: folder?.id });

    await deleteNode(raw, folder?.id as string);
    await expect(raw.nodes.purge({ nodeId: folder?.id as string })).rejects.toThrow(
      /contains a Base/i,
    );
  });
});
