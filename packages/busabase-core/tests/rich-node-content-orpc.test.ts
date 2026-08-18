import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type { WhiteboardDocument } from "busabase-contract/domains/rich-node/types";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * `PUT /nodes/{nodeId}/content` — the unified write for doc/whiteboard/
 * workflow/html (spec: apps/busabase/content/spec/node-content-storage.md,
 * D2/D3). This is the whiteboard/workflow/html half of the story: they used
 * to write straight to `node.metadata` through the generic PATCH endpoint,
 * with no ChangeRequest and no history at all. This test proves, against a
 * real oRPC router + PGLite + local object storage (not mocks), that a
 * whiteboard edit now:
 *
 *   1. is REVIEWABLE — a `changeRequest`-level actor's edit stays pending
 *      until a human approves it, exactly like a Doc edit;
 *   2. has a server-decided `autoMerge` — a `write`-level actor's edit merges
 *      immediately without asking the client, and the content actually lands
 *      in object storage at `busabase/nodes/{nodeId}/whiteboard/scene.json`.
 */

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const asManager = <T>(actorId: string, fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId, isSpaceManager: true }, fn);

const asMember = <T>(
  actorId: string,
  fn: () => Promise<T>,
  opts: { permissionLevel?: "read" | "changeRequest" | "write" | "manage" } = {},
) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId,
      isSpaceManager: false,
      permissionLevel: opts.permissionLevel ?? "changeRequest",
    },
    fn,
  );

const A_WHITEBOARD_DOCUMENT: WhiteboardDocument = {
  version: 1,
  elements: [{ id: "rect-1", type: "rectangle", x: 0, y: 0, width: 40, height: 20 }],
  appState: { viewBackgroundColor: "#ffffff" },
};

describe("nodes.updateContent — whiteboard (real oRPC + PGLite + storage)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let raw: RawClient;
  let whiteboardNodeId = "";

  const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-richcontent-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-richcontent-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    raw = createRouterClient(busabaseRouter);

    whiteboardNodeId = await asManager("alice", async () => {
      const rootId = (await raw.nodes.list({}))[0]?.id ?? "";
      expect(rootId).not.toBe("");
      const cr = await raw.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            parentNodeId: rootId,
            nodeType: "whiteboard",
            slug: "content-probe-board",
            name: "Content Probe Board",
          },
        ],
      });
      // Structural node_create auto-merges synchronously above; resolve the id.
      const tree = await raw.nodes.list({});
      const flatten = (entries: typeof tree): typeof tree =>
        entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
      const found = flatten(tree).find((node) => node.slug === "content-probe-board");
      expect(found, `expected the created whiteboard to be findable (cr ${cr.id})`).toBeTruthy();
      return found?.id ?? "";
    });
    expect(whiteboardNodeId).not.toBe("");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("starts with an empty document — no initial content accepted at node_create", async () => {
    const detail = await raw.nodes.get({ nodeId: whiteboardNodeId, type: "whiteboard" });
    if (detail.type !== "whiteboard") throw new Error("expected a whiteboard detail");
    expect(detail.document.elements).toEqual([]);
  });

  it("a changeRequest-level actor's edit stays pending (in_review), canvas unchanged", async () => {
    const cr = await asMember(
      "bob",
      () =>
        raw.nodes.updateContent({
          nodeId: whiteboardNodeId,
          content: { kind: "whiteboard", document: A_WHITEBOARD_DOCUMENT },
          submittedBy: "bob",
        }),
      { permissionLevel: "changeRequest" },
    );
    expect(cr.status).toBe("in_review");

    // Unchanged until a human approves + merges — the whole point of routing
    // this through a ChangeRequest instead of the old direct-metadata PATCH.
    const detail = await raw.nodes.get({ nodeId: whiteboardNodeId, type: "whiteboard" });
    if (detail.type !== "whiteboard") throw new Error("expected a whiteboard detail");
    expect(detail.document.elements).toEqual([]);
    await expect(
      storage.objectExists(`busabase/nodes/${whiteboardNodeId}/whiteboard/scene.json`),
    ).resolves.toBe(false);

    // A changeRequest-level actor passing `autoMerge: true` still lands in
    // review — the server decides, never the client (spec D3).
    const forced = await asMember(
      "bob",
      () =>
        raw.nodes.updateContent({
          nodeId: whiteboardNodeId,
          content: { kind: "whiteboard", document: A_WHITEBOARD_DOCUMENT },
          submittedBy: "bob",
          autoMerge: true,
        }),
      { permissionLevel: "changeRequest" },
    );
    expect(forced.status).toBe("in_review");
  });

  it("a write-level actor's edit (autoMerge omitted) merges immediately and writes real object storage", async () => {
    const cr = await asMember(
      "carol",
      () =>
        raw.nodes.updateContent({
          nodeId: whiteboardNodeId,
          content: { kind: "whiteboard", document: A_WHITEBOARD_DOCUMENT },
          submittedBy: "carol",
        }),
      { permissionLevel: "write" },
    );
    expect(cr.status).toBe("merged");
    // A real doc_update-shaped operation, not a metadata patch.
    expect(cr.primaryOperation?.operation).toBe("whiteboard_document_update");

    // The scene really landed in object storage at the path the spec commits to.
    const storageKey = `busabase/nodes/${whiteboardNodeId}/whiteboard/scene.json`;
    await expect(storage.objectExists(storageKey)).resolves.toBe(true);
    const raw_bytes = await storage.getObject(storageKey);
    expect(JSON.parse(raw_bytes.toString("utf8"))).toEqual(A_WHITEBOARD_DOCUMENT);

    // And the read path (`nodes.get`) reflects it too.
    const detail = await raw.nodes.get({ nodeId: whiteboardNodeId, type: "whiteboard" });
    if (detail.type !== "whiteboard") throw new Error("expected a whiteboard detail");
    expect(detail.document).toEqual(A_WHITEBOARD_DOCUMENT);
  });

  it("refuses a kind/type mismatch before writing anything", async () => {
    await expect(
      asManager("alice", () =>
        raw.nodes.updateContent({
          nodeId: whiteboardNodeId,
          content: { kind: "doc", body: "wrong kind for this node" },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("node metadata never accepted the document — the key is refused outright, not just unused", async () => {
    await expect(
      asManager("alice", () =>
        raw.nodes.updateMetadata({
          nodeId: whiteboardNodeId,
          metadata: { whiteboardDocument: A_WHITEBOARD_DOCUMENT },
        }),
      ),
    ).rejects.toThrow(/whiteboardDocument is not writable through node metadata/);
  });
});
