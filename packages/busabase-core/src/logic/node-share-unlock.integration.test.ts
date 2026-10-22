import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithAnonymousContext } from "../context";
import { getDb } from "../db";
import { busabaseNodes } from "../db/schema";
import { busabaseRouter } from "../router";
import { unlockPublicShare, validatePublicShareUnlockProofs } from "./node-share";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../../apps/busabase");
const SPACE_ID = "local";
const PASSWORD = "shared-folder-password";
type Proof = { nodeId: string; passwordVersion: string };

const asVisitor = <T>(fn: () => Promise<T>, unlockedShareNodeIds: string[] = []) =>
  runWithAnonymousContext({ spaceId: SPACE_ID, unlockedShareNodeIds }, fn);

describe("public folder password unlock boundaries", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let originalDatabaseUrl: string | undefined;
  let originalStorageUrl: string | undefined;
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

  const createFolder = async (slug: string, parentNodeId?: string) => {
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "create", nodeType: "folder", slug, name: slug, parentNodeId }],
    });
    const db = await getDb();
    const [node] = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.slug, slug));
    if (!node) throw new Error(`Missing fixture ${slug}`);
    return node.id;
  };

  const prove = async (nodeId: string, password = PASSWORD): Promise<Proof> => {
    const proof = await asVisitor(() => unlockPublicShare(nodeId, password));
    if (!proof?.passwordVersion) throw new Error("Password proof was not issued");
    return { nodeId: proof.nodeId, passwordVersion: proof.passwordVersion };
  };

  const validate = (proof: Proof) => asVisitor(() => validatePublicShareUnlockProofs([proof]));
  const move = (nodeId: string, parentNodeId: string) =>
    client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "move", nodeId, parentNodeId }],
    });

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalDatabaseUrl = process.env.PG_DATABASE_URL;
    originalStorageUrl = process.env.STORAGE_URL;
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-unlock-subtree-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-unlock-subtree-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    if (originalDatabaseUrl === undefined) delete process.env.PG_DATABASE_URL;
    else process.env.PG_DATABASE_URL = originalDatabaseUrl;
    if (originalStorageUrl === undefined) delete process.env.STORAGE_URL;
    else process.env.STORAGE_URL = originalStorageUrl;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { force: true, recursive: true });
    if (storageDir) await rm(storageDir, { force: true, recursive: true });
  });

  it("opens inherited descendants but never another share, then honors live overrides, moves, rotation and revocation", async () => {
    const root = await createFolder("unlock-parent");
    const child = await createFolder("unlock-child", root);
    const grandchild = await createFolder("unlock-grandchild", child);
    const override = await createFolder("unlock-override", root);
    const overrideChild = await createFolder("unlock-override-child", override);
    const other = await createFolder("unlock-other");
    await client.nodes.share.set({ nodeId: root, scope: "public", password: PASSWORD });
    await client.nodes.share.set({ nodeId: other, scope: "public", password: PASSWORD });
    const proof = await prove(root);

    const initial = await validate(proof);
    expect(initial.sort()).toEqual([root, child, grandchild, override, overrideChild].sort());
    expect(initial).not.toContain(other);
    const folder = await asVisitor(
      () => client.nodes.get({ nodeId: root, type: "folder" }),
      initial,
    );
    if (folder.type !== "folder") throw new Error("Expected folder detail");
    expect(folder.children.map((node) => node.id).sort()).toEqual([child, override].sort());

    // Even the same plaintext password on a nearer share is a separate grant.
    await client.nodes.share.set({ nodeId: override, scope: "public", password: PASSWORD });
    expect((await validate(proof)).sort()).toEqual([root, child, grandchild].sort());
    await client.nodes.share.set({ nodeId: override, scope: "public", password: null });
    expect((await validate(proof)).sort()).toEqual([root, child, grandchild].sort());

    // Revoke the override: the subtree now inherits the original folder again.
    await client.nodes.share.disable({ nodeId: override });
    expect((await validate(proof)).sort()).toEqual(
      [root, child, grandchild, override, overrideChild].sort(),
    );

    const childProof = await prove(child);
    await move(child, other);
    expect((await validate(proof)).sort()).toEqual([root, override, overrideChild].sort());
    expect(await validate(childProof)).toEqual([]);
    await move(child, root);
    expect((await validate(proof)).sort()).toEqual(
      [root, child, grandchild, override, overrideChild].sort(),
    );

    await client.nodes.share.set({ nodeId: root, scope: "public", password: "new-password" });
    expect(await validate(proof)).toEqual([]);
    expect(await validate(childProof)).toEqual([]);
    const rotated = await prove(root, "new-password");
    expect((await validate(rotated)).sort()).toEqual(
      [root, child, grandchild, override, overrideChild].sort(),
    );

    await client.nodes.share.set({
      nodeId: root,
      scope: "public",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await validate(rotated)).toEqual([]);
    await client.nodes.share.set({ nodeId: root, scope: "public", expiresAt: null });
    expect((await validate(rotated)).sort()).toEqual(
      [root, child, grandchild, override, overrideChild].sort(),
    );

    await client.nodes.share.disable({ nodeId: root });
    expect(await validate(rotated)).toEqual([]);
  }, 180_000);

  it("keeps a child proof inside its own active subtree and inside its space", async () => {
    const root = await createFolder("unlock-child-proof-parent");
    const child = await createFolder("unlock-child-proof", root);
    const grandchild = await createFolder("unlock-child-proof-grandchild", child);
    const sibling = await createFolder("unlock-child-proof-sibling", root);
    await client.nodes.share.set({ nodeId: root, scope: "public", password: PASSWORD });
    const proof = await prove(child);
    expect((await validate(proof)).sort()).toEqual([child, grandchild].sort());
    expect(await validate(proof)).not.toContain(root);
    expect(await validate(proof)).not.toContain(sibling);
    expect(
      await runWithAnonymousContext({ spaceId: "another-space" }, () =>
        validatePublicShareUnlockProofs([proof]),
      ),
    ).toEqual([]);

    const db = await getDb();
    await db
      .update(busabaseNodes)
      .set({ archivedAt: new Date() })
      .where(eq(busabaseNodes.id, grandchild));
    expect(await validate(proof)).toEqual([child]);
    await db
      .update(busabaseNodes)
      .set({ deletedAt: new Date() })
      .where(eq(busabaseNodes.id, child));
    expect(await validate(proof)).toEqual([]);
  }, 180_000);
});
