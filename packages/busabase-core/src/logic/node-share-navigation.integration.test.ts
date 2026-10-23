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
import {
  expireElapsedNodeShares,
  resolvePublicNavigation,
  unlockPublicShare,
  validatePublicShareUnlockProofs,
} from "./node-share";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../../apps/busabase");
const asVisitor = <T>(fn: () => Promise<T>, unlockedShareNodeIds: string[] = []) =>
  runWithAnonymousContext({ spaceId: "local", unlockedShareNodeIds }, fn);

describe("public folder navigation with real PGLite ACLs", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let originalDatabaseUrl: string | undefined;
  let originalStorageUrl: string | undefined;
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

  const createFolder = async (
    slug: string,
    parentNodeId?: string,
    nodeType: "folder" | "doc" = "folder",
  ) => {
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "create", nodeType, slug, name: slug, parentNodeId }],
    });
    const db = await getDb();
    const [node] = await db.select().from(busabaseNodes).where(eq(busabaseNodes.slug, slug));
    if (!node) throw new Error(`Missing fixture ${slug}`);
    return node.id;
  };
  const navigate = (nodeId: string, shareRoot?: string, unlocked: string[] = []) =>
    asVisitor(() => resolvePublicNavigation(nodeId, shareRoot), unlocked);
  const share = (nodeId: string, password?: string) =>
    client.nodes.share.set({ nodeId, scope: "public", password });

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalDatabaseUrl = process.env.PG_DATABASE_URL;
    originalStorageUrl = process.env.STORAGE_URL;
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-navigation-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-navigation-storage-"));
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

  it("returns a shared folder itself and nested inherited paths without private ancestors", async () => {
    const privateParent = await createFolder("nav-secret-parent");
    const root = await createFolder("nav-root", privateParent);
    const nested = await createFolder("nav-nested", root);
    const child = await createFolder("nav-child", nested, "doc");
    await share(root);
    expect((await navigate(root))?.path.map((node) => node.id)).toEqual([root]);
    const navigation = await navigate(child);
    expect(navigation?.root.id).toBe(root);
    expect(navigation?.path.map((node) => node.id)).toEqual([root, nested, child]);
    expect(JSON.stringify(navigation)).not.toContain("nav-secret-parent");
    await share(nested);
    expect((await navigate(child))?.path.map((node) => node.id)).toEqual([nested, child]);
    expect((await navigate(child, root))?.path.map((node) => node.id)).toEqual([
      root,
      nested,
      child,
    ]);
    await share(child);
    expect(await navigate(child)).toBeNull();
    expect((await navigate(child, root))?.path.map((node) => node.id)).toEqual([
      root,
      nested,
      child,
    ]);
  });

  it("rejects forged, inherited-only, cross-space and inaccessible roots", async () => {
    const root = await createFolder("nav-hint-root");
    const inherited = await createFolder("nav-hint-inherited", root);
    const child = await createFolder("nav-hint-child", inherited);
    const other = await createFolder("nav-hint-other");
    await share(root);
    await share(other);
    expect(await navigate(child, other)).toBeNull();
    expect(await navigate(child, inherited)).toBeNull();
    expect(await navigate(child, "missing-root")).toBeNull();
    expect(
      await runWithAnonymousContext({ spaceId: "other-space" }, () =>
        resolvePublicNavigation(child, root),
      ),
    ).toBeNull();
    expect(await resolvePublicNavigation(child, root)).toBeNull();
  });

  it("does not expose a private parent for an independently shared non-folder", async () => {
    const parent = await createFolder("nav-private-parent");
    const standalone = await createFolder("nav-standalone", parent, "doc");
    await share(standalone);
    expect(await navigate(standalone)).toBeNull();
    expect(await navigate(standalone, parent)).toBeNull();
  });

  it("keeps locked names out of folder reads and requires proof for every context ancestor", async () => {
    const root = await createFolder("nav-password-root");
    const child = await createFolder("nav-password-child", root);
    const locked = await createFolder("nav-password-locked", root);
    await share(root, "root-password");
    await share(locked, "other-password");
    expect(await navigate(child)).toBeNull();
    const proof = await asVisitor(() => unlockPublicShare(root, "root-password"));
    if (!proof?.passwordVersion) throw new Error("Missing unlock proof");
    const unlocked = await asVisitor(() =>
      validatePublicShareUnlockProofs([
        { nodeId: proof.nodeId, passwordVersion: proof.passwordVersion! },
      ]),
    );
    expect((await navigate(child, root, unlocked))?.path.map((node) => node.id)).toEqual([
      root,
      child,
    ]);
    const folder = await asVisitor(
      () => client.nodes.get({ nodeId: root, type: "folder" }),
      unlocked,
    );
    if (folder.type !== "folder") throw new Error("Expected folder");
    expect(folder.children.map((node) => node.id)).toEqual([child]);
    expect(JSON.stringify(folder)).not.toContain("nav-password-locked");
    await share(child);
    expect((await navigate(child))?.root.id).toBe(child);
    expect(await navigate(child, root)).toBeNull();
    await client.nodes.share.set({ nodeId: root, scope: "public", password: "rotated" });
    expect(
      await asVisitor(() =>
        validatePublicShareUnlockProofs([
          { nodeId: proof.nodeId, passwordVersion: proof.passwordVersion! },
        ]),
      ),
    ).toEqual([]);
  });

  it("revalidates revoked, expired, archived and deleted context nodes", async () => {
    const root = await createFolder("nav-live-root");
    const middle = await createFolder("nav-live-middle", root);
    const child = await createFolder("nav-live-child", middle);
    await share(root);
    await client.nodes.share.disable({ nodeId: root });
    expect(await navigate(child, root)).toBeNull();
    await client.nodes.share.set({
      nodeId: root,
      scope: "public",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await asVisitor(() => expireElapsedNodeShares());
    expect(await navigate(child, root)).toBeNull();
    await client.nodes.share.set({ nodeId: root, scope: "public", expiresAt: null });
    const db = await getDb();
    await db
      .update(busabaseNodes)
      .set({ archivedAt: new Date() })
      .where(eq(busabaseNodes.id, middle));
    expect(await navigate(child, root)).toBeNull();
    await db
      .update(busabaseNodes)
      .set({ archivedAt: null, deletedAt: new Date() })
      .where(eq(busabaseNodes.id, middle));
    expect(await navigate(child, root)).toBeNull();
  });

  it("rejects a former root after the node moves to another shared folder", async () => {
    const root = await createFolder("nav-move-root");
    const child = await createFolder("nav-move-child", root);
    const other = await createFolder("nav-move-other");
    await share(root);
    await share(other);
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "move", nodeId: child, parentNodeId: other }],
    });
    expect(await navigate(child, root)).toBeNull();
    expect((await navigate(child))?.path.map((node) => node.id)).toEqual([other, child]);
  });

  it("fails closed on cyclic topology", async () => {
    const root = await createFolder("nav-cycle-root");
    const child = await createFolder("nav-cycle-child", root);
    await share(root);
    const db = await getDb();
    await db.update(busabaseNodes).set({ parentId: child }).where(eq(busabaseNodes.id, child));
    expect(await navigate(child)).toBeNull();
    await db.update(busabaseNodes).set({ parentId: root }).where(eq(busabaseNodes.id, child));
  });
});
