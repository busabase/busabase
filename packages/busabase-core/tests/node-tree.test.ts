import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Node-tree + Doc lifecycle: folders and docs are plain `qin_nodes` rows, and
 * the tree is mutated through node change requests (create / rename / delete)
 * that fan out to per-type materializers on merge. Docs additionally write their
 * body to object storage. These paths are the database's structural backbone, so
 * they get direct create → merge coverage here against real PGLite + local storage.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Node tree + Doc lifecycle — oRPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-nodetree-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-nodetree-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    return client.changeRequests.merge({ changeRequestId });
  };

  // ── Docs (direct CRUD + storage-backed body) ──────────────────────────────
  describe("docs", () => {
    it("creates, reads (by slug and id), lists, and updates a Doc body", async () => {
      const created = await client.docs.create({
        slug: "lc-doc",
        name: "Lifecycle Doc",
        body: "# Hello\n",
      });
      expect(created.node.slug).toBe("lc-doc");
      expect(created.body).toBe("# Hello\n");

      // Read by slug and by node id.
      const bySlug = await client.docs.get({ nodeId: "lc-doc" });
      const byId = await client.docs.get({ nodeId: created.node.id });
      expect(bySlug.node.id).toBe(created.node.id);
      expect(byId.node.slug).toBe("lc-doc");

      expect((await client.docs.list()).some((d) => d.node.slug === "lc-doc")).toBe(true);

      const updated = await client.docs.updateBody({
        nodeId: created.node.id,
        body: "# Updated\n",
      });
      expect(updated.body).toBe("# Updated\n");
    });

    it("is idempotent on a duplicate slug", async () => {
      const first = await client.docs.create({ slug: "lc-doc-dup", name: "Dup", body: "a" });
      const second = await client.docs.create({ slug: "lc-doc-dup", name: "Dup2", body: "b" });
      expect(second.node.id).toBe(first.node.id);
    });

    it("rejects an unknown parent and a missing doc", async () => {
      await expect(
        client.docs.create({ parentNodeId: "pnd_nope", slug: "lc-doc-orphan", name: "X" }),
      ).rejects.toThrow(/Parent folder not found/);
      await expect(client.docs.get({ nodeId: "pnd_missing" })).rejects.toThrow(/Doc not found/);
    });

    it("updates a Doc body through a merged change request", async () => {
      const doc = await client.docs.create({ slug: "lc-doc-cr", name: "CR Doc", body: "v1" });
      const cr = await client.docs.createChangeRequest({
        nodeId: doc.node.id,
        body: "v2 via change request",
      });
      await approveAndMerge(cr.id);
      expect((await client.docs.get({ nodeId: doc.node.id })).body).toBe("v2 via change request");
    });
  });

  // ── Folders (read) ────────────────────────────────────────────────────────
  describe("folders", () => {
    it("lists seeded folders and reads one with its children", async () => {
      const folders = await client.folders.list();
      expect(folders.length).toBeGreaterThan(0);

      // The seeded "cms" folder holds the Blog + Pages Bases as children.
      const cms = await client.folders.get({ nodeId: "cms" });
      expect(cms.node.slug).toBe("cms");
      expect(cms.children.some((c) => c.slug === "blog")).toBe(true);
    });

    it("throws for an unknown folder", async () => {
      await expect(client.folders.get({ nodeId: "pnd_missing" })).rejects.toThrow(
        /Folder not found/,
      );
    });
  });

  // ── Node-tree change requests (create → rename → delete) ───────────────────
  describe("node change requests", () => {
    const folderSlug = async (slug: string) =>
      (await client.folders.list()).find((f) => f.node.slug === slug);

    it("creates, renames, and deletes a folder through auto-merged node CRs", async () => {
      // Structural node CRs auto-merge: the returned CR is already `merged`, so
      // no separate review/merge is needed (but a merged CR is still recorded).
      const createCr = await client.nodes.createChangeRequest({
        operations: [{ kind: "create", nodeType: "folder", slug: "lc-tree", name: "Tree" }],
      });
      expect(createCr.status).toBe("merged");
      const created = await folderSlug("lc-tree");
      expect(created).toBeDefined();
      const nodeId = created?.node.id ?? "";

      // Rename.
      const renameCr = await client.nodes.createChangeRequest({
        operations: [{ kind: "rename", nodeId, name: "Tree Renamed" }],
      });
      expect(renameCr.status).toBe("merged");
      expect((await folderSlug("lc-tree"))?.node.name).toBe("Tree Renamed");

      // Delete.
      const deleteCr = await client.nodes.createChangeRequest({
        operations: [{ kind: "delete", nodeId }],
      });
      expect(deleteCr.status).toBe("merged");
      expect(await folderSlug("lc-tree")).toBeUndefined();
    });

    it("materializes a Base node created through an auto-merged node CR", async () => {
      const cr = await client.nodes.createChangeRequest({
        operations: [
          {
            kind: "create",
            nodeType: "base",
            slug: "lc-node-base",
            name: "Node Base",
            fields: [{ slug: "title", name: "Title", type: "text", required: true }],
          },
        ],
      });
      expect(cr.status).toBe("merged");
      const bases = await client.bases.list();
      expect(bases.some((b) => b.slug === "lc-node-base")).toBe(true);
    });

    it("creates a folder and moves a node into it in ONE CR via temp-id", async () => {
      // A movable folder at the root.
      const movableCr = await client.nodes.createChangeRequest({
        operations: [{ kind: "create", nodeType: "folder", slug: "lc-movable", name: "Movable" }],
      });
      expect(movableCr.status).toBe("merged");
      const movableId = (await folderSlug("lc-movable"))?.node.id ?? "";
      expect(movableId).not.toBe("");

      // One CR: create a destination folder (ref "dest") + move Movable under it.
      // The move references the not-yet-materialized folder by its in-CR ref.
      const combo = await client.nodes.createChangeRequest({
        message: "Create Archive folder and move Movable into it",
        operations: [
          {
            kind: "create",
            ref: "dest",
            nodeType: "folder",
            slug: "lc-archive",
            name: "Archive",
          },
          { kind: "move", nodeId: movableId, parentNodeRef: "dest" },
        ],
      });
      expect(combo.status).toBe("merged");

      const archiveId = (await folderSlug("lc-archive"))?.node.id;
      expect(archiveId).toBeDefined();
      expect((await folderSlug("lc-movable"))?.node.parentId).toBe(archiveId);
    });

    it("rejects a move that references an undeclared parentNodeRef", async () => {
      await expect(
        client.nodes.createChangeRequest({
          operations: [{ kind: "move", nodeId: "nod_whatever", parentNodeRef: "ghost" }],
        }),
      ).rejects.toThrow(/no earlier operation declares/);
    });
  });
});
