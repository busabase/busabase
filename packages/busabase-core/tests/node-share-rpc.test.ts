import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/seed";
import { busabaseRouter } from "../src/router";

/**
 * The oRPC surface over public node sharing (`nodes.share.{get,set,disable}`).
 * The logic layer is covered by `node-sharing.test.ts`; this drives the router
 * client and, above all, proves the VO never carries the stored password hash.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("nodes.share RPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  let nodeId = "";
  /** A child of `nodeId`, used to prove the marker is NOT inherited. */
  let childNodeId = "";

  /** Every node in the tree, flattened — `nodes.list` returns a nested forest. */
  const flattenTree = (list: unknown[]) => {
    const flat: Array<{ id: string; slug: string; shared?: boolean; children?: unknown[] }> = [];
    const walk = (items: unknown[]) => {
      for (const raw of items) {
        const node = raw as { id: string; slug: string; shared?: boolean; children?: unknown[] };
        flat.push(node);
        if (node.children?.length) walk(node.children);
      }
    };
    walk(list);
    return flat;
  };

  const sharedFlagOf = async (id: string) =>
    flattenTree((await client.nodes.list({})) as unknown[]).find((n) => n.id === id)?.shared;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-rpc-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-rpc-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        { kind: "create", nodeType: "folder", slug: "share-rpc-root", name: "RPC Root" },
      ],
    });
    const flat: Array<{ id: string; slug: string; type: string; children?: unknown[] }> = [];
    const walk = (list: unknown[]) => {
      for (const raw of list) {
        const n = raw as { id: string; slug: string; type: string; children?: unknown[] };
        flat.push(n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk((await client.nodes.list({})) as unknown[]);
    nodeId = flat.find((n) => n.slug === "share-rpc-root")?.id ?? "";

    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "folder",
          parentNodeId: nodeId,
          slug: "share-rpc-child",
          name: "RPC Child",
        },
      ],
    });
    childNodeId =
      flattenTree((await client.nodes.list({})) as unknown[]).find(
        (n) => n.slug === "share-rpc-child",
      )?.id ?? "";
  }, 120_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { force: true, recursive: true });
    await rm(storageDir, { force: true, recursive: true });
  });

  it("returns null before the node has ever been shared", async () => {
    expect(await client.nodes.share.get({ nodeId })).toBeNull();
  });

  it("enables a public read share and never exposes a password hash", async () => {
    const set = await client.nodes.share.set({ nodeId, scope: "public", capability: "read" });
    expect(set).toMatchObject({ nodeId, scope: "public", capability: "read", hasPassword: false });
    expect(set).not.toHaveProperty("passwordHash");

    const got = await client.nodes.share.get({ nodeId });
    expect(got).toMatchObject({ scope: "public", hasPassword: false });
    expect(got).not.toHaveProperty("passwordHash");
    // The hash must not appear under ANY key.
    expect(JSON.stringify(got)).not.toContain("passwordHash");
  });

  // `NodeVO.shared` is what draws the sidebar's always-visible "shared
  // publicly" marker. It must reflect the node's OWN share row: a child of a
  // shared folder is publicly reachable but was never itself published, and
  // marking the whole subtree would bury the one row an admin is looking for.
  it("marks the shared node — and only it — in nodes.list", async () => {
    expect(await sharedFlagOf(nodeId)).toBe(true);
    expect(await sharedFlagOf(childNodeId)).toBe(false);
  });

  it("reports hasPassword=true after a password is set, still without the hash", async () => {
    const set = await client.nodes.share.set({ nodeId, scope: "public", password: "hunter2" });
    expect(set?.hasPassword).toBe(true);
    expect(set).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(set)).not.toContain("hunter2");

    const got = await client.nodes.share.get({ nodeId });
    expect(got?.hasPassword).toBe(true);
    expect(JSON.stringify(got)).not.toContain("hunter2");
    expect(JSON.stringify(got)).not.toContain("passwordHash");
  });

  it("disables the share back to scope none", async () => {
    const disabled = await client.nodes.share.disable({ nodeId });
    expect(disabled?.scope).toBe("none");
    expect(disabled).not.toHaveProperty("passwordHash");
  });

  it("drops the nodes.list marker once the share is revoked", async () => {
    expect(await sharedFlagOf(nodeId)).toBe(false);
  });

  // A share row that outlived its `expiresAt` no longer opens the link, so the
  // marker must not claim the node is published either.
  it("does not mark a share that has expired", async () => {
    await client.nodes.share.set({
      nodeId,
      scope: "public",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await sharedFlagOf(nodeId)).toBe(false);

    await client.nodes.share.set({ nodeId, scope: "public", expiresAt: null });
    expect(await sharedFlagOf(nodeId)).toBe(true);
  });
});
