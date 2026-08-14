import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * The security property behind "`visibility` is not writable through node
 * metadata", asserted the way a user would experience it: can another member
 * still SEE the node?
 *
 * A 400 from the metadata endpoint is only the mechanism. What actually
 * mattered is that the metadata patch used to write the declared value without
 * re-materializing `effectiveVisibility` — the column
 * `buildNodeVisibilityCondition` enforces — so the caller got a 200 for a node
 * that had not become private at all, and it then flipped to private later at
 * the next unrelated ACL recompute.
 *
 * Measured on this fixture with the guard removed:
 *   1. member sees the node
 *   2. PATCH metadata.visibility=private → 200, member STILL sees it
 *   3. an unrelated grant change (which recomputes the ACL) → member suddenly
 *      cannot see it
 *
 * These tests pin the fixed behaviour: the patch is refused, and the dedicated
 * endpoint hides the node immediately and stays that way.
 *
 * This runs against real actors rather than the local sentinel, because
 * visibility is only enforced for a non-manager member — see
 * `getContextIsSpaceManager`, whose absent-means-manager default is exactly why
 * a single-user self-hosted instance never observes any of this.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

/** A plain space member: not a manager, and holding no grant on the node. */
const asMember = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ actorId: "usr_member_bob", isSpaceManager: false }, fn);

const asManager = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ actorId: "usr_owner_alice", isSpaceManager: true }, fn);

describe("Node visibility enforcement across members", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let rootNodeId = "";
  let nodeId = "";

  const flatten = <T extends { children: T[] }>(entries: T[]): T[] =>
    entries.flatMap((entry) => [entry, ...flatten(entry.children)]);

  const memberCanSeeNode = async () => {
    const tree = await asMember(() => client.nodes.list({}));
    return flatten(tree).some((node) => node.id === nodeId);
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-vis-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-vis-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const nodes = await asManager(() => client.nodes.list({}));
    rootNodeId = nodes[0]?.id ?? "";
    expect(rootNodeId).not.toBe("");

    await asManager(() =>
      client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            parentNodeId: rootNodeId,
            nodeType: "folder",
            slug: "visibility-fixture",
            name: "Visibility fixture",
          },
        ],
      }),
    );
    const tree = await asManager(() => client.nodes.list({}));
    nodeId = flatten(tree).find((node) => node.slug === "visibility-fixture")?.id ?? "";
    expect(nodeId).not.toBe("");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("a plain member sees a node with no explicit visibility", async () => {
    expect(await memberCanSeeNode()).toBe(true);
  });

  it("the metadata patch cannot make a node private", async () => {
    await expect(
      asManager(() => client.nodes.updateMetadata({ nodeId, metadata: { visibility: "private" } })),
    ).rejects.toThrow(/visibility is not writable through node metadata/);
    // Refused, so nothing changed for the member either — no half-applied state.
    expect(await memberCanSeeNode()).toBe(true);
  });

  it("an unrelated ACL recompute does not flip visibility afterwards", async () => {
    // This is the delayed flip the old behaviour produced: with the declared
    // value written but `effectiveVisibility` stale, the NEXT recompute (any
    // grant change, any node move) silently hid the node. A refused patch must
    // leave nothing behind for a later recompute to act on.
    await asManager(() =>
      client.nodes.principals.add({
        nodeId: rootNodeId,
        principalType: "user",
        principalId: "usr_unrelated_carol",
        role: "read",
      }),
    );
    expect(await memberCanSeeNode()).toBe(true);
  });

  it("the dedicated endpoint hides the node from the member immediately", async () => {
    await asManager(() => client.nodes.updateVisibility({ nodeId, visibility: "private" }));
    expect(await memberCanSeeNode()).toBe(false);
  });

  it("and clearing it brings the node back", async () => {
    await asManager(() => client.nodes.updateVisibility({ nodeId, visibility: null }));
    expect(await memberCanSeeNode()).toBe(true);
  });
});
