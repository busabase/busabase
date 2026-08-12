import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithAnonymousContext } from "../src/context";
import { getPublicScopeOf } from "../src/logic/node-acl";
import { findPubliclySharedNode, unlockPublicShare } from "../src/logic/node-share";
import { busabaseRouter } from "../src/router";

/**
 * Share-link passwords, end to end.
 *
 * This used to be a control that did nothing. `setNodeShare` hashed and stored
 * the password, the dialog reported "a password is set", and `verifySharePassword`
 * existed — but nothing in the codebase ever called it, and the column the
 * anonymous read gate consults (`effective_public_scope`) was computed without
 * looking at `password_hash`. The result was a link the owner believed was
 * protected and that any visitor could open by pasting the URL.
 *
 * So the load-bearing assertion here is the negative one: an anonymous visitor
 * WITHOUT the password must see nothing.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const PASSWORD = "hunter2";
const SPACE_ID = "local";

/** An anonymous visitor who has proven nothing. */
const asVisitor = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithAnonymousContext({ spaceId: SPACE_ID }, fn);

/** An anonymous visitor the host has accepted an unlock proof from. */
const asUnlockedVisitor = <T>(nodeIds: string[], fn: () => Promise<T>): Promise<T> =>
  runWithAnonymousContext({ spaceId: SPACE_ID, unlockedShareNodeIds: nodeIds }, fn);

describe("share password gate", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  let openNodeId = "";
  let openSlug = "";
  let lockedNodeId = "";
  let lockedSlug = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-pw-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-pw-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const field = { slug: "name", name: "Name", type: "text", required: true, options: {} };
    const open = await client.bases.create({
      slug: "share-open",
      name: "Open Base",
      fields: [field],
      autoMerge: true,
    } as never);
    const locked = await client.bases.create({
      slug: "share-locked",
      name: "Locked Base",
      fields: [field],
      autoMerge: true,
    } as never);
    openNodeId = open.nodeId;
    openSlug = open.slug;
    lockedNodeId = locked.nodeId;
    lockedSlug = locked.slug;

    // Both are shared publicly; only one carries a password. The pair matters:
    // it proves the gate closes on the password specifically, not on sharing.
    await client.nodes.share.set({ nodeId: openNodeId, scope: "public" } as never);
    await client.nodes.share.set({
      nodeId: lockedNodeId,
      scope: "public",
      password: PASSWORD,
    } as never);
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("an unprotected public link still works", async () => {
    const scope = await asVisitor(() => getPublicScopeOf(openNodeId));
    expect(scope).toBe("read");
    const base = await asVisitor(() => client.bases.get({ baseId: openSlug } as never));
    expect(base.slug).toBe(openSlug);
  });

  // The one that was broken.
  it("a password-protected link is unreadable without the password", async () => {
    const scope = await asVisitor(() => getPublicScopeOf(lockedNodeId));
    expect(scope).toBeNull();
    await expect(
      asVisitor(() => client.bases.get({ baseId: lockedSlug } as never)),
    ).rejects.toThrow();
  });

  it("the locked node does not show up in the anonymous node tree either", async () => {
    const nodes = await asVisitor(() => client.nodes.list({} as never));
    const flatten = (rows: { id: string; children?: unknown[] }[]): string[] =>
      rows.flatMap((row) => [
        row.id,
        ...flatten((row.children ?? []) as { id: string; children?: unknown[] }[]),
      ]);
    const visible = flatten(nodes as never);
    expect(visible).toContain(openNodeId);
    expect(visible).not.toContain(lockedNodeId);
  });

  it("a wrong password does not unlock, and neither does an unknown node", async () => {
    expect(await asVisitor(() => unlockPublicShare(lockedSlug, "wrong"))).toBeNull();
    expect(await asVisitor(() => unlockPublicShare("no-such-node", PASSWORD))).toBeNull();
  });

  it("the right password unlocks exactly that node, and nothing else", async () => {
    const unlocked = await asVisitor(() => unlockPublicShare(lockedSlug, PASSWORD));
    expect(unlocked).toEqual({ nodeId: lockedNodeId });

    const base = await asUnlockedVisitor([lockedNodeId], () =>
      client.bases.get({ baseId: lockedSlug } as never),
    );
    expect(base.slug).toBe(lockedSlug);
  });

  // Guards the obvious bypass: an unlock proof is per node, so holding one for
  // node A must not open a different password-protected node B.
  it("an unlock for one node does not unlock another", async () => {
    const other = await client.bases.create({
      slug: "share-locked-2",
      name: "Locked Base 2",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    } as never);
    await client.nodes.share.set({
      nodeId: other.nodeId,
      scope: "public",
      password: "different",
    } as never);

    const scope = await asUnlockedVisitor([lockedNodeId], () => getPublicScopeOf(other.nodeId));
    expect(scope).toBeNull();
  });

  it("clearing the password reopens the link without one", async () => {
    await client.nodes.share.set({
      nodeId: lockedNodeId,
      scope: "public",
      password: null,
    } as never);
    const scope = await asVisitor(() => getPublicScopeOf(lockedNodeId));
    expect(scope).toBe("read");

    // Put it back for any later reads of this fixture.
    await client.nodes.share.set({
      nodeId: lockedNodeId,
      scope: "public",
      password: PASSWORD,
    } as never);
  });

  // A challenge page has to be able to say "this needs a password" — resolution
  // stays possible while every actual read stays closed.
  it("resolution reports the lock so a challenge page can be rendered", async () => {
    const resolved = await asVisitor(() => findPubliclySharedNode("base", lockedSlug));
    expect(resolved?.id).toBe(lockedNodeId);
    expect(resolved?.requiresPassword).toBe(true);

    const openResolved = await asVisitor(() => findPubliclySharedNode("base", openSlug));
    expect(openResolved?.requiresPassword).toBe(false);
  });
});
