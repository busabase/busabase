import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithAnonymousContext, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseNodeShares } from "../src/db/schema";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { createDoc } from "../src/domains/doc/handlers";
import { encodeVaultValue } from "../src/domains/vault/logic/vault-crypto";
import { getEffectiveNodeLevel, getPublicScopeOf, grantNodePrincipal } from "../src/logic/node-acl";
import {
  disableNodeShare,
  expireElapsedNodeShares,
  getNodeShare,
  hashSharePassword,
  hasNodeShareHistory,
  isShareLive,
  setNodeShare,
  unlockPublicShare,
  validatePublicShareUnlockProofs,
  verifySharePassword,
} from "../src/logic/node-share";
import { seedScenario } from "../src/logic/seed";
import { busabaseRouter } from "../src/router";

/**
 * Public node sharing (plan P1): the second, orthogonal axis that lets an
 * anonymous visitor reach a node at its own canonical URL.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("public node sharing", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  let folderNodeId = "";
  let childNodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-share-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    // A folder with a base inside it, to exercise inheritance.
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "create", nodeType: "folder", slug: "share-root", name: "Share Root" }],
    });
    const flat: Array<{ id: string; slug: string; type: string }> = [];
    const walk = (list: unknown[]) => {
      for (const raw of list) {
        const n = raw as { id: string; slug: string; type: string; children?: unknown[] };
        flat.push(n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk((await client.nodes.list({})) as unknown[]);
    folderNodeId = flat.find((n) => n.slug === "share-root")?.id ?? "";

    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "folder",
          slug: "share-child",
          name: "Share Child",
          parentNodeId: folderNodeId,
        },
      ],
    });
    const flat2: Array<{ id: string; slug: string; type: string }> = [];
    const walk2 = (list: unknown[]) => {
      for (const raw of list) {
        const n = raw as { id: string; slug: string; type: string; children?: unknown[] };
        flat2.push(n);
        if (n.children?.length) walk2(n.children);
      }
    };
    walk2((await client.nodes.list({})) as unknown[]);
    childNodeId = flat2.find((n) => n.slug === "share-child")?.id ?? "";
  }, 120_000);

  const findNodeIdBySlug = async (slug: string): Promise<string | undefined> => {
    const flat: Array<{ id: string; slug: string }> = [];
    const walk = (list: unknown[]) => {
      for (const raw of list) {
        const n = raw as { id: string; slug: string; children?: unknown[] };
        flat.push(n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk((await client.nodes.list({})) as unknown[]);
    return flat.find((n) => n.slug === slug)?.id;
  };

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { force: true, recursive: true });
    await rm(storageDir, { force: true, recursive: true });
  });

  it("hashes share passwords instead of storing them", async () => {
    const stored = await hashSharePassword("hunter2");
    expect(stored).not.toContain("hunter2");
    expect(await verifySharePassword("hunter2", stored)).toBe(true);
    expect(await verifySharePassword("wrong", stored)).toBe(false);
  });

  it("keeps a node closed to anonymous visitors until it is shared", async () => {
    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(folderNodeId)).toBeNull();
    });
  });

  it("opens the node — and its descendants — once shared", async () => {
    await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read" });
    });
    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(folderNodeId)).toBe("read");
      // Sharing a folder exposes children at their own URLs (inheritance is
      // materialized at write time).
      expect(await getEffectiveNodeLevel(childNodeId)).toBe("read");
    });
  });

  it("never grants more than read, even at the submit capability", async () => {
    await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "submit" });
    });
    await runWithAnonymousContext({}, async () => {
      // `submit` authorizes opening a ChangeRequest elsewhere; it must not show
      // up as a higher ACL level here.
      expect(await getEffectiveNodeLevel(folderNodeId)).toBe("read");
    });
  });

  it("closes immediately on revoke, and the row survives so the link still works later", async () => {
    const before = await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read" });
      return getPublicScopeOf(folderNodeId);
    });
    expect(before).toBe("read");

    const revoked = await runWithBusabaseContext({}, async () => {
      await disableNodeShare(folderNodeId);
      return getPublicScopeOf(folderNodeId);
    });
    expect(revoked).toBeNull();

    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(folderNodeId)).toBeNull();
      expect(await getEffectiveNodeLevel(childNodeId)).toBeNull();
      expect(await hasNodeShareHistory("folder", "share-root")).toBe(true);
      expect(await hasNodeShareHistory("folder", "share-child")).toBe(true);
      expect(await hasNodeShareHistory("folder", "never-shared-path")).toBe(false);
    });

    // Re-enabling works on the same row — no new id, so the URL is unchanged.
    const reopened = await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read" });
      return getPublicScopeOf(folderNodeId);
    });
    expect(reopened).toBe("read");
  });

  it("treats an expired share as closed", () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    expect(isShareLive({ scope: "public", expiresAt: past })).toBe(false);
    expect(isShareLive({ scope: "public", expiresAt: future })).toBe(true);
    expect(isShareLive({ scope: "public", expiresAt: null })).toBe(true);
    expect(isShareLive({ scope: "none", expiresAt: null })).toBe(false);
  });

  it("closes a future-dated share on the first anonymous request after expiry", async () => {
    await runWithBusabaseContext({}, () =>
      setNodeShare(folderNodeId, {
        scope: "public",
        capability: "read",
        expiresAt: new Date(Date.now() + 25),
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    await runWithAnonymousContext({}, async () => {
      expect(await expireElapsedNodeShares()).toBe(1);
      expect(await getEffectiveNodeLevel(folderNodeId)).toBeNull();
      expect(await getEffectiveNodeLevel(childNodeId)).toBeNull();
      expect(await hasNodeShareHistory("folder", "share-root")).toBe(true);
      expect(await expireElapsedNodeShares()).toBe(0);
    });
  });

  it("refuses a password on a non-public share", async () => {
    await runWithBusabaseContext({}, async () => {
      await expect(
        setNodeShare(folderNodeId, { scope: "none", password: "hunter2" }),
      ).rejects.toThrow(/publicly shared/i);
    });
  });

  it("invalidates an existing unlock proof as soon as the share password changes", async () => {
    await runWithBusabaseContext({}, () =>
      setNodeShare(folderNodeId, {
        scope: "public",
        password: "old-password",
        expiresAt: null,
      }),
    );
    const unlocked = await runWithAnonymousContext({}, () =>
      unlockPublicShare(folderNodeId, "old-password", "folder"),
    );
    expect(unlocked?.passwordVersion).toBeTruthy();
    const oldProof = {
      nodeId: folderNodeId,
      passwordVersion: unlocked?.passwordVersion ?? "",
    };
    const unlockedShareNodeIds = await runWithAnonymousContext({}, () =>
      validatePublicShareUnlockProofs([oldProof]),
    );
    expect(unlockedShareNodeIds).toEqual([folderNodeId, childNodeId]);
    await runWithAnonymousContext({ unlockedShareNodeIds }, async () => {
      for (const nodeId of [folderNodeId, childNodeId]) {
        expect(await getEffectiveNodeLevel(nodeId)).toBe("read");
        await expect(client.nodes.get({ nodeId })).resolves.toMatchObject({ node: { id: nodeId } });
      }
    });

    await runWithBusabaseContext({}, () =>
      setNodeShare(folderNodeId, { scope: "public", password: "new-password" }),
    );
    const invalidatedIds = await runWithAnonymousContext({}, () =>
      validatePublicShareUnlockProofs([oldProof]),
    );
    expect(invalidatedIds).toEqual([]);
    await runWithAnonymousContext({ unlockedShareNodeIds: invalidatedIds }, async () => {
      for (const nodeId of [folderNodeId, childNodeId]) {
        expect(await getEffectiveNodeLevel(nodeId)).toBeNull();
        await expect(client.nodes.get({ nodeId })).rejects.toThrow(/not found/i);
      }
      expect(await unlockPublicShare(folderNodeId, "old-password", "folder")).toBeNull();
    });
    const freshUnlock = await runWithAnonymousContext({}, () =>
      unlockPublicShare(folderNodeId, "new-password", "folder"),
    );
    expect(freshUnlock?.passwordVersion).toBeTruthy();
    const freshIds = await runWithAnonymousContext({}, () =>
      validatePublicShareUnlockProofs([
        { nodeId: folderNodeId, passwordVersion: freshUnlock?.passwordVersion ?? "" },
      ]),
    );
    expect(freshIds).toEqual([folderNodeId, childNodeId]);
    await runWithAnonymousContext({ unlockedShareNodeIds: freshIds }, async () => {
      for (const nodeId of [folderNodeId, childNodeId]) {
        expect(await getEffectiveNodeLevel(nodeId)).toBe("read");
        await expect(client.nodes.get({ nodeId })).resolves.toMatchObject({ node: { id: nodeId } });
      }
    });
  });

  it("publishes a node created inside an already-shared folder", async () => {
    await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read", password: null });
    });
    // Both create doors: the Doc fast path and the generic change-request merge.
    const doc = await runWithBusabaseContext({}, () =>
      createDoc({
        slug: "share-late-doc",
        name: "Late Doc",
        body: "",
        parentNodeId: folderNodeId,
      }),
    );
    if (!doc.materialized) throw new Error("expected the doc to materialize immediately");
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "folder",
          slug: "share-late-folder",
          name: "Late Folder",
          parentNodeId: folderNodeId,
        },
      ],
    });
    const lateFolderId = (await findNodeIdBySlug("share-late-folder")) ?? "";

    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(doc.node.id)).toBe("read");
      expect(await getEffectiveNodeLevel(lateFolderId)).toBe("read");
    });
  });

  it("publishes a node moved into a shared folder and closes it when moved out", async () => {
    await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read", password: null });
    });
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "create", nodeType: "folder", slug: "share-mover", name: "Mover" }],
    });
    const moverId = (await findNodeIdBySlug("share-mover")) ?? "";
    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(moverId)).toBeNull();
    });

    await client.nodes.move({ nodeId: moverId, parentNodeId: folderNodeId });
    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(moverId)).toBe("read");
    });

    const rootId = (await client.nodes.list({}))[0]?.id;
    await client.nodes.move({ nodeId: moverId, parentNodeId: rootId });
    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(moverId)).toBeNull();
    });
  });

  it("marks inherited exposure on the tree separately from the folder's own share", async () => {
    await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read", password: null });
    });
    const flat: Array<{ id: string; shared?: boolean; sharedViaAncestor?: boolean }> = [];
    const walk = (list: unknown[]) => {
      for (const raw of list) {
        const n = raw as {
          id: string;
          shared?: boolean;
          sharedViaAncestor?: boolean;
          children?: unknown[];
        };
        flat.push(n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk((await client.nodes.list({})) as unknown[]);
    const folder = flat.find((n) => n.id === folderNodeId);
    const child = flat.find((n) => n.id === childNodeId);
    expect(folder).toMatchObject({ shared: true, sharedViaAncestor: false });
    expect(child).toMatchObject({ shared: false, sharedViaAncestor: true });

    await runWithBusabaseContext({}, () => disableNodeShare(folderNodeId));
    const after: typeof flat = [];
    const walkAfter = (list: unknown[]) => {
      for (const raw of list) {
        const n = raw as (typeof flat)[number] & { children?: unknown[] };
        after.push(n);
        if (n.children?.length) walkAfter(n.children);
      }
    };
    walkAfter((await client.nodes.list({})) as unknown[]);
    expect(after.find((n) => n.id === childNodeId)).toMatchObject({
      shared: false,
      sharedViaAncestor: false,
    });
  });

  it("drops the inherited marker once the ancestor's share expires, without an anonymous visit", async () => {
    // Nothing anonymous touches the space in between: the member's own tree
    // read is what has to notice the elapsed share and close the subtree.
    await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, {
        scope: "public",
        capability: "read",
        password: null,
        expiresAt: new Date(Date.now() + 1_500),
      });
    });
    const markersOf = async () => {
      const flat: Array<{ id: string; shared?: boolean; sharedViaAncestor?: boolean }> = [];
      const walk = (list: unknown[]) => {
        for (const raw of list) {
          const n = raw as (typeof flat)[number] & { children?: unknown[] };
          flat.push(n);
          if (n.children?.length) walk(n.children);
        }
      };
      walk((await client.nodes.list({})) as unknown[]);
      return {
        folder: flat.find((n) => n.id === folderNodeId),
        child: flat.find((n) => n.id === childNodeId),
      };
    };
    expect((await markersOf()).child).toMatchObject({ sharedViaAncestor: true });

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    // The first read after the deadline performs the sweep (its own node rows
    // were read concurrently and may still be stale); from then on it is closed.
    await markersOf();
    const after = await markersOf();
    expect(after.folder).toMatchObject({ shared: false, sharedViaAncestor: false });
    expect(after.child).toMatchObject({ shared: false, sharedViaAncestor: false });
    // …and the sweep closed the materialized scope itself, not just the marker.
    await runWithAnonymousContext({}, async () => {
      expect(await getEffectiveNodeLevel(childNodeId)).toBeNull();
    });
  });

  describe("retrievable share passwords", () => {
    // A real key, so the stored payload is genuinely encrypted (the no-key
    // fallback stores it plain, exactly as Vault does).
    const VAULT_KEY = "a".repeat(64);
    let revealNodeId = "";

    const asOwner = <T>(fn: () => Promise<T>) => runWithBusabaseContext({}, fn);
    const asMember = <T>(
      actorId: string,
      permissionLevel: "read" | "changeRequest" | "write" | "manage",
      fn: () => Promise<T>,
    ) => runWithBusabaseContext({ actorId, isSpaceManager: false, permissionLevel }, fn);
    const rawRow = async () => {
      const db = await getDb();
      const [row] = await db
        .select()
        .from(busabaseNodeShares)
        .where(eq(busabaseNodeShares.nodeId, revealNodeId));
      return row;
    };

    beforeAll(async () => {
      await client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          { kind: "create", nodeType: "folder", slug: "share-reveal", name: "Share Reveal" },
        ],
      });
      revealNodeId = (await findNodeIdBySlug("share-reveal")) ?? "";
      expect(revealNodeId).not.toBe("");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("gives the manager the password back, encrypted at rest beside the scrypt verifier", async () => {
      vi.stubEnv("BUSABASE_VAULT_ENCRYPTION_KEY", VAULT_KEY);
      const set = await asOwner(() =>
        setNodeShare(revealNodeId, { scope: "public", password: "482913" }),
      );
      expect(set).toMatchObject({ hasPassword: true, password: "482913" });
      expect(await asOwner(() => getNodeShare(revealNodeId))).toMatchObject({
        hasPassword: true,
        password: "482913",
      });
      // The logic result is not the row: neither secret column travels.
      expect(set).not.toHaveProperty("passwordHash");
      expect(set).not.toHaveProperty("passwordCiphertext");

      const row = await rawRow();
      expect(row?.passwordCiphertext).toMatchObject({ encoding: "encrypted" });
      expect(JSON.stringify(row?.passwordCiphertext)).not.toContain("482913");
      expect(await verifySharePassword("482913", row?.passwordHash ?? "")).toBe(true);
    });

    it("keeps both columns when the password is omitted, so other settings don't clear it", async () => {
      vi.stubEnv("BUSABASE_VAULT_ENCRYPTION_KEY", VAULT_KEY);
      const before = await rawRow();
      const updated = await asOwner(() =>
        setNodeShare(revealNodeId, { scope: "public", capability: "submit" }),
      );
      expect(updated).toMatchObject({ capability: "submit", password: "482913" });
      const after = await rawRow();
      expect(after?.passwordHash).toBe(before?.passwordHash);
      expect(after?.passwordCiphertext).toEqual(before?.passwordCiphertext);
      await asOwner(() => setNodeShare(revealNodeId, { scope: "public", capability: "read" }));
    });

    it("tells a member below manage that the link is locked, but not what opens it", async () => {
      vi.stubEnv("BUSABASE_VAULT_ENCRYPTION_KEY", VAULT_KEY);
      for (const level of ["read", "changeRequest", "write"] as const) {
        const seen = await asMember("usr_member_bob", level, () => getNodeShare(revealNodeId));
        expect(seen, level).toMatchObject({ hasPassword: true, password: null });
        const viaRpc = await asMember("usr_member_bob", level, () =>
          client.nodes.share.get({ nodeId: revealNodeId }),
        );
        expect(viaRpc, level).toMatchObject({ hasPassword: true, password: null });
        expect(JSON.stringify(viaRpc)).not.toContain("482913");
      }

      // `manage` on the NODE (not only the workspace) is what reveals it.
      await asOwner(() =>
        grantNodePrincipal(
          revealNodeId,
          { principalType: "user", principalId: "usr_member_carol", role: "manage" },
          "local-user",
        ),
      );
      expect(
        await asMember("usr_member_carol", "read", () => getNodeShare(revealNodeId)),
      ).toMatchObject({ hasPassword: true, password: "482913" });
    });

    it("shows nothing — and does not fail — when the key no longer opens the stored password", async () => {
      vi.stubEnv("BUSABASE_VAULT_ENCRYPTION_KEY", "b".repeat(64));
      expect(await asOwner(() => getNodeShare(revealNodeId))).toMatchObject({
        hasPassword: true,
        password: null,
      });
      // The link itself is untouched: unlocking only ever checks the hash.
      expect(
        await runWithAnonymousContext({}, () =>
          unlockPublicShare(revealNodeId, "482913", "folder"),
        ),
      ).toMatchObject({ nodeId: revealNodeId });
    });

    it("treats a row from before this change (hash only) as locked but unshowable", async () => {
      const db = await getDb();
      await db
        .update(busabaseNodeShares)
        .set({ passwordHash: await hashSharePassword("legacy-pass"), passwordCiphertext: null })
        .where(eq(busabaseNodeShares.nodeId, revealNodeId));

      expect(await asOwner(() => getNodeShare(revealNodeId))).toMatchObject({
        hasPassword: true,
        password: null,
      });
      expect(
        await runWithAnonymousContext({}, () =>
          unlockPublicShare(revealNodeId, "legacy-pass", "folder"),
        ),
      ).toMatchObject({ nodeId: revealNodeId, passwordVersion: expect.any(String) });
    });

    it("never shows a stale password that an older server left behind after changing the hash", async () => {
      // An old pod mid-deploy rewrites `password_hash` and knows nothing about
      // the ciphertext column, so the previous password's ciphertext survives.
      const db = await getDb();
      await db
        .update(busabaseNodeShares)
        .set({
          passwordHash: await hashSharePassword("changed-elsewhere"),
          passwordCiphertext: encodeVaultValue("stale-old-pass"),
        })
        .where(eq(busabaseNodeShares.nodeId, revealNodeId));

      expect(await asOwner(() => getNodeShare(revealNodeId))).toMatchObject({
        hasPassword: true,
        password: null,
      });
    });

    it("changing the password makes it readable again and retires the old unlock version", async () => {
      const before = await runWithAnonymousContext({}, () =>
        unlockPublicShare(revealNodeId, "changed-elsewhere", "folder"),
      );
      await asOwner(() => setNodeShare(revealNodeId, { scope: "public", password: "731052" }));

      expect(await asOwner(() => getNodeShare(revealNodeId))).toMatchObject({
        password: "731052",
      });
      const after = await runWithAnonymousContext({}, () =>
        unlockPublicShare(revealNodeId, "731052", "folder"),
      );
      expect(after?.passwordVersion).toBeTruthy();
      expect(after?.passwordVersion).not.toBe(before?.passwordVersion);
      expect(
        await runWithAnonymousContext({}, () =>
          unlockPublicShare(revealNodeId, "changed-elsewhere", "folder"),
        ),
      ).toBeNull();
    });

    it("clearing the password removes the verifier and the ciphertext together", async () => {
      const cleared = await asOwner(() =>
        setNodeShare(revealNodeId, { scope: "public", password: null }),
      );
      expect(cleared).toMatchObject({ hasPassword: false, password: null });
      const row = await rawRow();
      expect(row?.passwordHash).toBeNull();
      expect(row?.passwordCiphertext).toBeNull();
    });

    it.each([
      ["empty", ""],
      ["three characters", "123"],
      ["65 characters", "x".repeat(65)],
    ])("refuses a %s password in the logic layer and at the contract", async (_label, password) => {
      await expect(
        asOwner(() => setNodeShare(revealNodeId, { scope: "public", password })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        client.nodes.share.set({ nodeId: revealNodeId, scope: "public", password }),
      ).rejects.toThrow();
      // Nothing was written: the link is still open, not locked behind a
      // password nobody could enter.
      expect(await asOwner(() => getNodeShare(revealNodeId))).toMatchObject({
        hasPassword: false,
      });
    });
  });

  it("leaves member access untouched while shared", async () => {
    await runWithBusabaseContext({}, async () => {
      await setNodeShare(folderNodeId, { scope: "public", capability: "read" });
      // The member path is the other axis entirely — still full access.
      expect(await getEffectiveNodeLevel(folderNodeId)).toBe("manage");
    });
  });
});
