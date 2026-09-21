import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../context";
import { busabaseRouter } from "../router";
import { listOwnLiveShares } from "./node-share";

/**
 * The space-level public-share listing behind `nodes.share.list` — the
 * `/shared` audit table and the sidebar's "Shared" filter.
 *
 * Driven against a real PGLite database rather than a mocked db, because
 * three of the four properties under test are enforced by the query itself:
 * the `scope = "public"` filter, the node-visibility ACL join, and the
 * expiry predicate. A stubbed db would assert the shape of the code instead
 * of the behaviour of the listing.
 *
 * Runs with real actors (not the local sentinel) for the ACL case: node
 * visibility is only enforced for a non-manager member — see
 * `getContextIsSpaceManager`, whose absent-means-manager default is why a
 * single-user self-hosted install never observes any of it.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const asManager = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ actorId: "usr_owner_alice", isSpaceManager: true }, fn);

/** A plain space member: not a manager, holding no grant on any node. */
const asMember = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ actorId: "usr_member_bob", isSpaceManager: false }, fn);

describe("listOwnLiveShares", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  const nodeIdBySlug = new Map<string, string>();

  const flatten = <T extends { children: T[] }>(entries: T[]): T[] =>
    entries.flatMap((entry) => [entry, ...flatten(entry.children)]);

  const createFolder = async (slug: string) => {
    await asManager(() =>
      client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [{ kind: "create", nodeType: "folder", slug, name: slug }],
      }),
    );
    const tree = await asManager(() => client.nodes.list({}));
    const id = flatten(tree).find((node) => node.slug === slug)?.id ?? "";
    expect(id).not.toBe("");
    nodeIdBySlug.set(slug, id);
    return id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-list-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-list-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    // Live, open to anyone with the link.
    const openId = await createFolder("share-list-open");
    await asManager(() => client.nodes.share.set({ nodeId: openId, scope: "public" }));

    // Live, but password-protected — the `hasPassword` case.
    const lockedId = await createFolder("share-list-locked");
    await asManager(() =>
      client.nodes.share.set({
        nodeId: lockedId,
        scope: "public",
        capability: "submit",
        password: "hunter2",
      }),
    );

    // Published, then expired. The row is still `scope: "public"`, which is
    // exactly why expiry cannot be left to the SQL filter alone.
    const expiredId = await createFolder("share-list-expired");
    await asManager(() =>
      client.nodes.share.set({
        nodeId: expiredId,
        scope: "public",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );

    // Published, then revoked. The row is KEPT with `scope: "none"` on purpose
    // (re-enabling reopens the same address), so "has a share row" is not the
    // same question as "is shared".
    const revokedId = await createFolder("share-list-revoked");
    await asManager(() => client.nodes.share.set({ nodeId: revokedId, scope: "public" }));
    await asManager(() => client.nodes.share.disable({ nodeId: revokedId }));

    // Live public share on a node a plain member cannot see at all. Both
    // things are true at once, and they are not in conflict: public link
    // sharing and in-space visibility are orthogonal axes.
    const hiddenId = await createFolder("share-list-hidden");
    await asManager(() => client.nodes.share.set({ nodeId: hiddenId, scope: "public" }));
    await asManager(() =>
      client.nodes.updateVisibility({ nodeId: hiddenId, visibility: "private" }),
    );
  }, 180_000);

  afterAll(async () => {
    // Deliberately does NOT `delete process.env.PG_DATABASE_URL` / `STORAGE_URL`,
    // matching every other PGLite test here. `process.env` is process-global and
    // vitest runs several test files per worker, so clearing it drops any file
    // still running in this worker back to the DEFAULT `pglite://.data/busabase`
    // — a RELATIVE path, resolved against the package root. Two of them landing
    // there at once is `EEXIST: mkdir packages/busabase-core/.data/busabase`,
    // an unhandled rejection that fails the whole run with every test passing.
    // The next file's `beforeAll` overwrites these anyway; leaving them set is
    // what makes the handoff safe.
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { force: true, recursive: true });
    if (storageDir) await rm(storageDir, { force: true, recursive: true });
  });

  it("lists only nodes with a live public share, never an expired or revoked one", async () => {
    const rows = await asManager(() => listOwnLiveShares());

    expect(rows.map((row) => row.slug).sort()).toEqual([
      "share-list-hidden",
      "share-list-locked",
      "share-list-open",
    ]);
  });

  it("carries the node identity an audit row needs", async () => {
    const rows = await asManager(() => listOwnLiveShares());
    const open = rows.find((row) => row.slug === "share-list-open");

    expect(open).toMatchObject({
      nodeId: nodeIdBySlug.get("share-list-open"),
      name: "share-list-open",
      type: "folder",
      capability: "read",
      expiresAt: null,
    });
  });

  it("reduces the stored password to a boolean and never exposes the hash", async () => {
    const rows = await asManager(() => listOwnLiveShares());
    const locked = rows.find((row) => row.slug === "share-list-locked");
    const open = rows.find((row) => row.slug === "share-list-open");

    expect(locked?.hasPassword).toBe(true);
    expect(locked?.capability).toBe("submit");
    expect(open?.hasPassword).toBe(false);
    // Not just "the field is absent from the type" — the runtime object must
    // not carry the hash under any spelling, since this is what the router
    // serializes.
    expect(Object.keys(locked ?? {})).not.toContain("passwordHash");
    expect(JSON.stringify(rows)).not.toContain("hunter2");
    // scrypt output is `salt:hash`, both hex — a leak would show up as a long
    // hex run, whatever the key it travelled under.
    expect(JSON.stringify(rows)).not.toMatch(/[0-9a-f]{64}/);
  });

  it("omits a shared node the caller cannot see, so its name cannot leak", async () => {
    const rows = await asMember(() => listOwnLiveShares());

    expect(rows.map((row) => row.slug).sort()).toEqual(["share-list-locked", "share-list-open"]);
    expect(rows.some((row) => row.slug === "share-list-hidden")).toBe(false);
  });
});
