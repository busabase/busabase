import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Rich-node metadata is only useful if the API refuses to accept metadata the
 * node type will never read. A whiteboard's drawing lives under
 * `whiteboardDocument`; writing it to `metadata.scene` used to return 200,
 * store a key nobody reads, and leave the canvas untouched — the caller had no
 * way to tell that apart from a broken renderer.
 *
 * Both write paths are covered, since they are separate entry points:
 *   - `nodes.updateMetadata` — the direct PATCH agents/the SDK use
 *   - `nodes.createChangeRequest` — the create path, which validated nothing
 *
 * The negative case matters just as much: metadata is free-form by design on
 * every other node type (busabase-cms keeps its Base-id mapping under
 * `busabaseCms` on a folder), so folders must still accept arbitrary keys.
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

    await createNode("whiteboard", "meta-test-board", {
      whiteboardDocument: VALID_WHITEBOARD_DOCUMENT,
    });
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
    it("accepts the node type's own document key", async () => {
      const updated = await client.nodes.updateMetadata({
        nodeId: whiteboardNodeId,
        metadata: { whiteboardDocument: VALID_WHITEBOARD_DOCUMENT },
      });
      expect(updated.metadata.whiteboardDocument).toBeDefined();
    });

    it("rejects a misspelled document key instead of silently storing it", async () => {
      // The original bug report: `metadata.scene` returned 200 and rendered nothing.
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: { scene: VALID_WHITEBOARD_DOCUMENT },
        }),
      ).rejects.toThrow(/Unknown metadata key for new|Unknown metadata key for node/);
    });

    it("names the key the caller should have used", async () => {
      await expect(
        client.nodes.updateMetadata({ nodeId: whiteboardNodeId, metadata: { elements: [] } }),
      ).rejects.toThrow(/whiteboardDocument/);
    });

    it("rejects another rich node type's document key", async () => {
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: { workflowDocument: { version: 2, nodes: [], edges: [] } },
        }),
      ).rejects.toThrow(/Unknown metadata key/);
    });

    it("still accepts the common keys every node type shares", async () => {
      const updated = await client.nodes.updateMetadata({
        nodeId: whiteboardNodeId,
        metadata: { version: "2", assetId: "ast_x" },
      });
      expect(updated.metadata.version).toBe("2");
    });

    it("leaves free-form metadata on non-rich node types alone", async () => {
      // busabase-cms depends on exactly this: an app-defined key on a folder.
      const updated = await client.nodes.updateMetadata({
        nodeId: folderNodeId,
        metadata: { busabaseCms: { schemaVersion: 1, profile: "standard", bases: {} } },
      });
      expect(updated.metadata.busabaseCms).toBeDefined();
    });

    it("still rejects an invalid document value", async () => {
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          // No `version: 1` — parseWhiteboardDocument would blank the canvas.
          metadata: { whiteboardDocument: { elements: [] } },
        }),
      ).rejects.toThrow(/Invalid whiteboardDocument/);
    });

    it("rejects the whole patch when only one key is unknown", async () => {
      await expect(
        client.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: { whiteboardDocument: VALID_WHITEBOARD_DOCUMENT, scene: { junk: true } },
        }),
      ).rejects.toThrow(/Unknown metadata key/);
      // …and nothing from that patch landed.
      const nodes = await client.nodes.list({});
      const flatten = (entries: typeof nodes): typeof nodes =>
        entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
      const board = flatten(nodes).find((node) => node.id === whiteboardNodeId);
      expect(board?.metadata.scene).toBeUndefined();
    });
  });

  describe("nodes.createChangeRequest (create path)", () => {
    it("rejects an unknown metadata key at submission time", async () => {
      await expect(
        createNode("whiteboard", "meta-test-bad-key", { scene: VALID_WHITEBOARD_DOCUMENT }),
      ).rejects.toThrow(/Unknown metadata key/);
    });

    it("rejects an invalid document instead of merging a canvas that reads back empty", async () => {
      await expect(
        createNode("whiteboard", "meta-test-bad-doc", { whiteboardDocument: { elements: [] } }),
      ).rejects.toThrow(/Invalid whiteboardDocument/);
    });

    it("creates no node when the metadata is refused", async () => {
      const nodes = await client.nodes.list({});
      const flatten = (entries: typeof nodes): typeof nodes =>
        entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
      const slugs = flatten(nodes).map((node) => node.slug);
      expect(slugs).not.toContain("meta-test-bad-key");
      expect(slugs).not.toContain("meta-test-bad-doc");
    });

    it("still creates a folder carrying app-defined metadata", async () => {
      await expect(
        createNode("folder", "meta-test-cms-folder", { busabaseCms: { bases: {} } }),
      ).resolves.toBeDefined();
    });
  });
});
