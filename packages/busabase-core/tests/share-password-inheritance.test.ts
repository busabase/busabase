import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithAnonymousContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseNodeShares, busabaseNodes } from "../src/db/schema";
import { getPublicScopeOf } from "../src/logic/node-acl";
import { unlockPublicShare } from "../src/logic/node-share";
import { busabaseRouter } from "../src/router";

/**
 * Share passwords through INHERITANCE — the case that decides where the lock
 * bit has to live.
 *
 * Sharing a folder opens its descendants at their own URLs, and a descendant
 * gets NO row in `busabase_node_shares` (the shares table holds authored
 * intent: one row per node someone explicitly shared). So "is this node behind
 * a password?" cannot be answered from that table for the nodes that most need
 * it — there is nothing there to answer with. It is resolved at write time by
 * `recomputeEffectivePublicScope` and materialized onto every node, exactly as
 * `effective_public_scope` already is.
 *
 * `share-password-gate.test.ts` covers the direct case (share this node, with a
 * password). This file covers what that one cannot: a child that is locked by
 * an ancestor's password, and the "nearer share wins" rule that lets a child
 * re-open itself.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const SPACE_ID = "local";
const PASSWORD = "hunter2";

const asVisitor = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithAnonymousContext({ spaceId: SPACE_ID }, fn);

describe("share password inheritance", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  let folderNodeId = "";
  let childNodeId = "";
  let childSlug = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-inherit-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-inherit-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const folderCr = await client.nodes.createChangeRequest({
      message: "Create shared folder",
      operations: [
        {
          kind: "create",
          ref: "f",
          nodeType: "folder",
          slug: "shared-folder",
          name: "Shared Folder",
        },
      ],
      autoMerge: true,
    } as never);
    folderNodeId = folderCr.mergeSummary?.mergedNodeIds?.[0] as string;

    const base = await client.bases.create({
      slug: "inherited-base",
      name: "Inherited Base",
      parentNodeId: folderNodeId,
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    } as never);
    childNodeId = base.nodeId;
    childSlug = base.slug;

    // The FOLDER is shared, with a password. The child is never touched.
    await client.nodes.share.set({
      nodeId: folderNodeId,
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

  // The structural reason the bit is materialized on the node, not stored on
  // the share: the child that needs it has no share row at all.
  it("an inherited child is publicly reachable with no row of its own in busabase_node_shares", async () => {
    const db = await getDb();
    const shareRows = await db
      .select()
      .from(busabaseNodeShares)
      .where(eq(busabaseNodeShares.nodeId, childNodeId));
    expect(shareRows).toHaveLength(0);

    const [node] = await db
      .select({
        scope: busabaseNodes.effectivePublicScope,
        requiresPassword: busabaseNodes.effectivePublicRequiresPassword,
      })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, childNodeId));
    expect(node?.scope).toBe("read");
    expect(node?.requiresPassword).toBe(true);
  });

  it("the ancestor's password locks the child for an anonymous visitor", async () => {
    expect(await asVisitor(() => getPublicScopeOf(childNodeId))).toBeNull();
    await expect(
      asVisitor(() => client.bases.get({ baseId: childSlug } as never)),
    ).rejects.toThrow();
  });

  it("the ancestor's password is what unlocks the child", async () => {
    expect(await asVisitor(() => unlockPublicShare(childSlug, "wrong"))).toBeNull();
    expect(await asVisitor(() => unlockPublicShare(childSlug, PASSWORD))).toEqual({
      nodeId: childNodeId,
    });
  });

  // "Nearer share wins" — the same rule capability already follows. A child
  // that re-shares itself without a password is NOT held shut by an ancestor's.
  it("a nearer password-free share on the child re-opens it", async () => {
    await client.nodes.share.set({ nodeId: childNodeId, scope: "public" } as never);
    expect(await asVisitor(() => getPublicScopeOf(childNodeId))).toBe("read");
    // …while the folder itself stays locked.
    expect(await asVisitor(() => getPublicScopeOf(folderNodeId))).toBeNull();
  });
});
