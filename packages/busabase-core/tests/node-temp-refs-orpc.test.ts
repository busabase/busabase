import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * In-change-request temp references: one CR can create a folder AND parent other
 * nodes under it (or move existing nodes into it) in a single submission, by
 * pointing `parentNodeRef` at a `ref` an earlier operation declares — no need to
 * merge the folder first to learn its real id. Exercised through the real router.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const findNode = (tree: Array<{ slug: string; children?: unknown[] }>, slug: string): any => {
  for (const node of tree) {
    if (node.slug === slug) return node;
    const nested = node.children ? findNode(node.children as typeof tree, slug) : undefined;
    if (nested) return nested;
  }
  return undefined;
};

describe("Node CR temp refs — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-noderef-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-noderef-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates a folder and nests new nodes under it via parentNodeRef in one CR", async () => {
    const cr = await client.nodes.createChangeRequest({
      message: "Set up the Growth workspace",
      operations: [
        { kind: "create", ref: "growth", nodeType: "folder", slug: "growth", name: "Growth" },
        {
          kind: "create",
          parentNodeRef: "growth",
          nodeType: "base",
          slug: "campaigns",
          name: "Campaigns",
          fields: [{ slug: "title", name: "Title", type: "text", required: true }],
        },
        {
          kind: "create",
          parentNodeRef: "growth",
          nodeType: "doc",
          slug: "playbook",
          name: "Playbook",
        },
      ],
    });
    expect(cr.status).toBe("in_review");
    expect(cr.operationCount).toBe(3);

    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });

    const tree = (await client.nodes.list()) as Array<{ slug: string; children?: unknown[] }>;
    const growth = findNode(tree, "growth");
    expect(growth).toBeDefined();
    const childSlugs = (growth.children ?? []).map((c: { slug: string }) => c.slug).sort();
    expect(childSlugs).toEqual(["campaigns", "playbook"]);
  });

  it("moves an existing node into a folder created in the same CR (parentNodeRef on move)", async () => {
    // A pre-existing top-level doc.
    await client.docs.create({ slug: "orphan-note", name: "Orphan Note", body: "hi\n" });
    const before = (await client.nodes.list()) as Array<{ slug: string; children?: unknown[] }>;
    const orphan = findNode(before, "orphan-note");
    expect(orphan).toBeDefined();

    const cr = await client.nodes.createChangeRequest({
      message: "File the orphan note under Archive",
      operations: [
        { kind: "create", ref: "archive", nodeType: "folder", slug: "archive", name: "Archive" },
        { kind: "move", nodeId: orphan.id, parentNodeRef: "archive" },
      ],
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });

    const after = (await client.nodes.list()) as Array<{ slug: string; children?: unknown[] }>;
    const archive = findNode(after, "archive");
    expect((archive.children ?? []).some((c: { slug: string }) => c.slug === "orphan-note")).toBe(
      true,
    );
    // It is no longer at the root.
    expect(after.some((n) => n.slug === "orphan-note")).toBe(false);
  });

  it("rejects a forward/unknown parentNodeRef at submission time (no CR created)", async () => {
    const queueBefore = await client.changeRequests.list({ limit: 100 });
    await expect(
      client.nodes.createChangeRequest({
        operations: [
          // References "later" before it is declared.
          { kind: "create", parentNodeRef: "later", nodeType: "folder", slug: "a", name: "A" },
          { kind: "create", ref: "later", nodeType: "folder", slug: "later", name: "Later" },
        ],
      }),
    ).rejects.toThrow(/parentNodeRef/i);
    const queueAfter = await client.changeRequests.list({ limit: 100 });
    expect(queueAfter.length).toBe(queueBefore.length);
  });

  it("rejects setting both parentNodeId and parentNodeRef", async () => {
    await expect(
      client.nodes.createChangeRequest({
        operations: [
          { kind: "create", ref: "f", nodeType: "folder", slug: "f", name: "F" },
          {
            kind: "create",
            parentNodeId: "nod_whatever",
            parentNodeRef: "f",
            nodeType: "doc",
            slug: "d",
            name: "D",
          },
        ],
      }),
    ).rejects.toThrow(/exactly one/i);
  });
});
