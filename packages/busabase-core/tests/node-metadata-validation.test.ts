import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Rich-node CONTENT (a whiteboard's `whiteboardDocument`, a workflow's
 * `workflowDocument`, an HTML page's `htmlDocument`) no longer lives in
 * `node.metadata` at all — it moved to object storage behind
 * `PUT /nodes/{nodeId}/content` (spec D2/D3, PR that follows #6291). The three
 * document keys are refused OUTRIGHT through node metadata now, on any node
 * type — not validated-then-allowed, the way they briefly were.
 *
 * Both write paths are covered, since they are separate entry points:
 *   - `nodes.updateMetadata` — the direct PATCH agents/the SDK use
 *   - `nodes.createChangeRequest` — the create path
 *
 * The negative case matters just as much: metadata is free-form by design on
 * every node type (busabase-cms keeps its Base-id mapping under `busabaseCms`
 * on a folder), and — now that the document itself is refused outright —
 * that includes rich node types too. There is no more "unknown key on a rich
 * node type" allowlist to police; `metadata.scene` on a whiteboard is just
 * inert extension data now, same as any other key on any other type.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const VALID_WHITEBOARD_DOCUMENT = {
  version: 1 as const,
  elements: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
  appState: {},
};

describe("Node metadata validation", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let rootNodeId = "";
  let whiteboardNodeId = "";
  let folderNodeId = "";

  const createNode = async (nodeType: string, slug: string, metadata: Record<string, unknown>) =>
    client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          parentNodeId: rootNodeId,
          nodeType: nodeType as "whiteboard",
          slug,
          name: slug,
          metadata,
        },
      ],
    });

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-meta-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-meta-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const nodes = await client.nodes.list({});
    rootNodeId = nodes[0]?.id ?? "";
    expect(rootNodeId).not.toBe("");

    // No document key here: node_create no longer accepts initial content for
    // whiteboard/workflow/html — content is added afterward through
    // `PUT /nodes/{nodeId}/content`.
    await createNode("whiteboard", "meta-test-board", {});
    await createNode("folder", "meta-test-folder", {});
    const tree = await client.nodes.list({});
    const flatten = (entries: typeof tree): typeof tree =>
      entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
    const all = flatten(tree);
    whiteboardNodeId = all.find((node) => node.slug === "meta-test-board")?.id ?? "";
    folderNodeId = all.find((node) => node.slug === "meta-test-folder")?.id ?? "";
    expect(whiteboardNodeId).not.toBe("");
    expect(folderNodeId).not.toBe("");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  describe("nodes.updateMetadata", () => {
    it("rejects the node type's own document key, pointing at the content endpoint", async () => {
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: { whiteboardDocument: VALID_WHITEBOARD_DOCUMENT },
        }),
      ).rejects.toThrow(/whiteboardDocument is not writable through node metadata/);
    });

    it("rejects another rich node type's document key too — the block is unconditional", async () => {
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: { workflowDocument: { version: 2, nodes: [], edges: [] } },
        }),
      ).rejects.toThrow(/workflowDocument is not writable through node metadata/);
    });

    it("names the endpoint the caller should use instead", async () => {
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: { htmlDocument: { version: 1, source: "<p>hi</p>" } },
        }),
      ).rejects.toThrow(new RegExp(`/nodes/${whiteboardNodeId}/content`));
    });

    it("no longer polices other keys on a rich node type — same as any other type", async () => {
      // Previously an allowlist rejected an unrecognized key like `scene` on a
      // whiteboard node. That allowlist is gone along with the document key it
      // was built to protect: a rich node's metadata is ordinary free-form
      // extension data now, exactly like a folder's.
      const updated = await client.nodes.updateMetadata({
        nodeId: whiteboardNodeId,
        metadata: { scene: { junk: true }, elements: [] },
      });
      expect(updated.metadata.scene).toBeDefined();
    });

    it("still accepts genuinely free-form extension keys", async () => {
      // The bag is for the caller's own data — busabase-cms keeps its Base-id
      // mapping here, and anything else a third party wants to hang off a node.
      // Refusing product-enforced keys must not turn this into an allowlist.
      const updated = await client.nodes.updateMetadata({
        nodeId: whiteboardNodeId,
        metadata: { busabaseCms: { baseId: "bas_x" }, myPluginState: "anything" },
      });
      expect(updated.metadata.busabaseCms).toEqual({ baseId: "bas_x" });
      expect(updated.metadata.myPluginState).toBe("anything");
    });

    it("refuses `version`, which is changed through a reviewed file-tree change request", async () => {
      // Not a permission bypass like `visibility` — a REVIEW bypass. A file
      // tree's version is edited through `fileTrees.createChangeRequest`, which
      // a human approves; this endpoint needs only `write` and creates no
      // ChangeRequest, so an open key here let the review be skipped by using
      // the generic door.
      //
      // The value still lives in `metadata` — it is a label the user writes and
      // the product never interprets. Only the door is closed.
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: { version: "2" },
        }),
      ).rejects.toThrow(/version is not writable through node metadata/);
    });

    it("refuses `visibility`, which is access control rather than metadata", async () => {
      // Writing it here set the declared value but never re-materialized
      // `effectiveVisibility` (the column the ACL enforces), so the caller got a
      // 200 for a node that had NOT actually changed visibility — and would flip
      // silently at the next unrelated ACL recompute.
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: { visibility: "private" },
        }),
      ).rejects.toThrow(/visibility is not writable through node metadata/);
      await expect(
        client.nodes.updateMetadata({ nodeId: folderNodeId, metadata: { visibility: "private" } }),
      ).rejects.toThrow(/visibility is not writable through node metadata/);
    });

    it("points the caller at the endpoint that does the job properly", async () => {
      await expect(
        client.nodes.updateMetadata({
          nodeId: folderNodeId,
          metadata: { visibility: "workspace" },
        }),
      ).rejects.toThrow(/\/visibility/);
    });

    it("leaves the node untouched when `visibility` is refused", async () => {
      const before = await client.nodes.get({ nodeId: folderNodeId });
      await expect(
        client.nodes.updateMetadata({
          nodeId: folderNodeId,
          // A legitimate key alongside the refused one: the whole patch is rejected.
          metadata: { visibility: "private", busabaseCms: { bases: {} } },
        }),
      ).rejects.toThrow(/visibility is not writable/);
      const after = await client.nodes.get({ nodeId: folderNodeId });
      expect(after.metadata).toEqual(before.metadata);
    });

    it("the dedicated visibility endpoint still works", async () => {
      await expect(
        client.nodes.updateVisibility({ nodeId: folderNodeId, visibility: "private" }),
      ).resolves.toEqual({ updated: true });
      await client.nodes.updateVisibility({ nodeId: folderNodeId, visibility: null });
    });

    it("refuses `visibility`, which is access control rather than metadata", async () => {
      // Writing it here set the declared value but never re-materialized
      // `effectiveVisibility` (the column the ACL enforces), so the caller got a
      // 200 for a node that had NOT actually changed visibility — and would flip
      // silently at the next unrelated ACL recompute.
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: { visibility: "private" },
        }),
      ).rejects.toThrow(/visibility is not writable through node metadata/);
      await expect(
        client.nodes.updateMetadata({ nodeId: folderNodeId, metadata: { visibility: "private" } }),
      ).rejects.toThrow(/visibility is not writable through node metadata/);
    });

    it("points the caller at the endpoint that does the job properly", async () => {
      await expect(
        client.nodes.updateMetadata({
          nodeId: folderNodeId,
          metadata: { visibility: "workspace" },
        }),
      ).rejects.toThrow(/\/visibility/);
    });

    it("leaves the node untouched when `visibility` is refused", async () => {
      const before = await client.nodes.get({ nodeId: folderNodeId });
      await expect(
        client.nodes.updateMetadata({
          nodeId: folderNodeId,
          // A legitimate key alongside the refused one: the whole patch is rejected.
          metadata: { visibility: "private", busabaseCms: { bases: {} } },
        }),
      ).rejects.toThrow(/visibility is not writable/);
      const after = await client.nodes.get({ nodeId: folderNodeId });
      expect(after.metadata).toEqual(before.metadata);
    });

    it("the dedicated visibility endpoint still works", async () => {
      await expect(
        client.nodes.updateVisibility({ nodeId: folderNodeId, visibility: "private" }),
      ).resolves.toEqual({ updated: true });
      await client.nodes.updateVisibility({ nodeId: folderNodeId, visibility: null });
    });

    it("leaves free-form metadata on non-rich node types alone", async () => {
      // busabase-cms depends on exactly this: an app-defined key on a folder.
      const updated = await client.nodes.updateMetadata({
        nodeId: folderNodeId,
        metadata: { busabaseCms: { schemaVersion: 1, profile: "standard", bases: {} } },
      });
      expect(updated.metadata.busabaseCms).toBeDefined();
    });

    it("rejects the whole patch when it carries a blocked document key alongside a legit one", async () => {
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: {
            whiteboardDocument: VALID_WHITEBOARD_DOCUMENT,
            assetId: "ast_should_not_land",
          },
        }),
      ).rejects.toThrow(/whiteboardDocument is not writable through node metadata/);
      // …and nothing from that patch landed, including the legitimate key.
      const nodes = await client.nodes.list({});
      const flatten = (entries: typeof nodes): typeof nodes =>
        entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
      const board = flatten(nodes).find((node) => node.id === whiteboardNodeId);
      expect(board?.metadata.assetId).not.toBe("ast_should_not_land");
    });
  });

  describe("nodes.createChangeRequest (create path)", () => {
    it("rejects a document key at node-creation time too", async () => {
      await expect(
        createNode("whiteboard", "meta-test-bad-doc", {
          whiteboardDocument: VALID_WHITEBOARD_DOCUMENT,
        }),
      ).rejects.toThrow(/whiteboardDocument is not writable through node metadata/);
    });

    it("creates no node when the metadata is refused", async () => {
      const nodes = await client.nodes.list({});
      const flatten = (entries: typeof nodes): typeof nodes =>
        entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
      const slugs = flatten(nodes).map((node) => node.slug);
      expect(slugs).not.toContain("meta-test-bad-doc");
    });

    it("still creates a whiteboard node carrying an unrelated metadata key", async () => {
      await expect(
        createNode("whiteboard", "meta-test-scene-key", { scene: { junk: true } }),
      ).resolves.toBeDefined();
    });

    it("still creates a folder carrying app-defined metadata", async () => {
      await expect(
        createNode("folder", "meta-test-cms-folder", { busabaseCms: { bases: {} } }),
      ).resolves.toBeDefined();
    });
  });
});
