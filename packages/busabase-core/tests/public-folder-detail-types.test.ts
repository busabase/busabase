import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithAnonymousContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseNodes } from "../src/db/schema";
import { resolveAssetContent } from "../src/domains/assets/logic/asset-content-logic";
import {
  disableNodeShare,
  setNodeShare,
  unlockPublicShare,
  validatePublicShareUnlockProofs,
} from "../src/logic/node-share";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const asVisitor = <T>(fn: () => Promise<T>) => runWithAnonymousContext({}, fn);

describe("shared folder detail types — real router, PGLite and object storage", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let originalDatabaseUrl: string | undefined;
  let originalStorageUrl: string | undefined;
  let client: Client;
  let folderId = "";
  let htmlId = "";
  let skillId = "";
  let driveId = "";
  let airappId = "";
  let privateDriveId = "";
  let fileAssetId = "";
  let airappAssetId = "";
  let publicAliasFileId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalDatabaseUrl = process.env.PG_DATABASE_URL;
    originalStorageUrl = process.env.STORAGE_URL;
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-public-types-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-public-types-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const folder = await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        { kind: "create", nodeType: "folder", slug: "shared-types", name: "Shared types" },
      ],
    });
    folderId = String(folder.mergeSummary.mergedNodeIds[0]);
    const html = await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "html",
          parentNodeId: folderId,
          slug: "shared-html",
          name: "Shared HTML",
        },
      ],
    });
    htmlId = String(html.mergeSummary.mergedNodeIds[0]);
    await client.nodes.updateContent({
      nodeId: htmlId,
      content: { kind: "html", document: { version: 1, source: "<h1>Shared HTML document</h1>" } },
    });
    for (const type of ["skill", "drive", "airapp"] as const) {
      const result = await client.fileTrees.create({
        autoMerge: true,
        type,
        parentNodeId: folderId,
        slug: `shared-${type}`,
        name: `Shared ${type}`,
        files: [
          {
            path: type === "skill" ? "SKILL.md" : "README.md",
            content: `${type} unique public content\n`,
          },
        ],
      });
      if (!("node" in result)) throw new Error("Expected materialized file tree");
      if (type === "skill") skillId = result.node.id;
      if (type === "drive") driveId = result.node.id;
      if (type === "airapp") {
        airappId = result.node.id;
        airappAssetId = result.files.find((file) => file.path === "README.md")?.assetId ?? "";
      }
    }
    const privateDrive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "private-drive",
      name: "Private Drive",
    });
    if (!("node" in privateDrive)) throw new Error("Expected materialized drive");
    privateDriveId = privateDrive.node.id;
    const source = await client.fileTrees.readFile({
      nodeId: driveId,
      type: "drive",
      filePath: "README.md",
    });
    fileAssetId = source.assetId;
    await client.assets.putText({ assetId: fileAssetId, text: source.content });
    await client.files.create({
      autoMerge: true,
      parentNodeId: folderId,
      slug: "shared-text-file",
      name: "Shared text File",
      assetId: fileAssetId,
    });
    await setNodeShare(folderId, { scope: "public", capability: "read" });
  }, 120_000);

  afterAll(async () => {
    if (originalDatabaseUrl === undefined) delete process.env.PG_DATABASE_URL;
    else process.env.PG_DATABASE_URL = originalDatabaseUrl;
    if (originalStorageUrl === undefined) delete process.env.STORAGE_URL;
    else process.env.STORAGE_URL = originalStorageUrl;
    process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir])
      if (dir) await rm(dir, { force: true, recursive: true });
  });

  it("hydrates inherited HTML content and Skill/Drive inventories, by id and slug", async () => {
    const folder = await asVisitor(() => client.nodes.get({ nodeId: folderId }));
    if (folder.type !== "folder") throw new Error("Expected folder");
    expect(folder.children.map((node) => node.id)).toEqual(
      expect.arrayContaining([htmlId, skillId, driveId, airappId]),
    );
    const html = await asVisitor(() => client.nodes.get({ nodeId: "shared-html", type: "html" }));
    expect(html).toMatchObject({
      type: "html",
      document: { source: "<h1>Shared HTML document</h1>" },
    });
    for (const [type, nodeId, slug, entryFile] of [
      ["skill", skillId, "shared-skill", "SKILL.md"],
      ["drive", driveId, "shared-drive", "README.md"],
    ] as const) {
      for (const ref of [nodeId, slug]) {
        const detail = await asVisitor(() => client.nodes.get({ nodeId: ref, type }));
        expect(detail).toMatchObject({
          type,
          node: { id: nodeId },
          files: expect.arrayContaining([expect.objectContaining({ path: entryFile })]),
        });
        await expect(
          asVisitor(() => client.fileTrees.readFile({ nodeId: ref, type, filePath: entryFile })),
        ).resolves.toMatchObject({ nodeId, content: `${type} unique public content\n` });
      }
    }
  });

  it("renders a text File through its visible usage without exposing the asset library", async () => {
    await expect(
      asVisitor(() =>
        client.assets.readTextLines({ assetId: fileAssetId, startLine: 1, endLine: 20 }),
      ),
    ).resolves.toMatchObject({ lines: ["drive unique public content"] });
    await expect(asVisitor(() => client.assets.list({}))).rejects.toThrow(/anonymous/i);
  });

  it("denies AirApp inventory, file bytes, type-hint spoofing and asset-id bypass", async () => {
    await expect(asVisitor(() => client.nodes.get({ nodeId: airappId }))).rejects.toThrow(
      /anonymous/i,
    );
    await expect(
      asVisitor(() => client.fileTrees.readFile({ nodeId: airappId, filePath: "README.md" })),
    ).rejects.toThrow(/anonymous/i);
    await expect(
      asVisitor(() =>
        client.fileTrees.readFile({ nodeId: airappId, type: "drive", filePath: "README.md" }),
      ),
    ).rejects.toThrow(/not found/i);
    await expect(
      asVisitor(() =>
        client.assets.readTextLines({ assetId: airappAssetId, startLine: 1, endLine: 20 }),
      ),
    ).rejects.toThrow(/not found/i);
    await expect(asVisitor(() => resolveAssetContent(airappAssetId))).rejects.toThrow(/not found/i);
  });

  it("keeps private and cross-space file refs unreadable", async () => {
    await expect(
      asVisitor(() => client.fileTrees.readFile({ nodeId: privateDriveId, filePath: "README.md" })),
    ).rejects.toThrow(/not found/i);
    await expect(
      runWithAnonymousContext({ spaceId: `${LOCAL_SPACE_ID}_other` }, () =>
        client.fileTrees.readFile({ nodeId: driveId, filePath: "README.md" }),
      ),
    ).rejects.toThrow(/not found/i);
    await expect(
      runWithAnonymousContext({ spaceId: `${LOCAL_SPACE_ID}_other` }, () =>
        client.assets.readTextLines({ assetId: fileAssetId, startLine: 1, endLine: 20 }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("allows an asset's deliberate public File mount while rejecting an unmounted staging asset", async () => {
    const stagedInput = {
      fileName: "staged.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      contentHash: `sha256:${"f".repeat(64)}`,
    };
    const stagedUpload = await client.assets.createUploadUrl(stagedInput);
    const unmounted = await client.assets.confirm({
      ...stagedInput,
      storageKey: stagedUpload.storageKey,
    });
    await expect(
      asVisitor(() =>
        client.assets.readTextLines({
          assetId: unmounted.assetId as string,
          startLine: 1,
          endLine: 20,
        }),
      ),
    ).rejects.toThrow(/not found/i);
    await client.assets.putText({
      assetId: airappAssetId,
      text: "Deliberately shared file content",
    });
    const alias = await client.files.create({
      autoMerge: true,
      parentNodeId: folderId,
      slug: "public-airapp-file-mount",
      name: "Deliberately shared file",
      assetId: airappAssetId,
    });
    if (!("node" in alias)) throw new Error("Expected a materialized public File");
    publicAliasFileId = alias.node.id;
    await expect(
      asVisitor(() =>
        client.assets.readTextLines({ assetId: airappAssetId, startLine: 1, endLine: 20 }),
      ),
    ).resolves.toMatchObject({ lines: ["Deliberately shared file content"] });
  });

  it("refuses archived and deleted public mounts while preserving member reads", async () => {
    const db = await getDb();
    for (const inactiveState of [
      { archivedAt: new Date(), deletedAt: null },
      { archivedAt: null, deletedAt: new Date() },
    ]) {
      // Keep usage and materialized share rows present to exercise the read
      // guard itself rather than relying on archive/purge cleanup side effects.
      await db
        .update(busabaseNodes)
        .set(inactiveState)
        .where(eq(busabaseNodes.id, publicAliasFileId));
      await expect(
        asVisitor(() =>
          client.assets.readTextLines({ assetId: airappAssetId, startLine: 1, endLine: 20 }),
        ),
      ).rejects.toThrow(/not found/i);
      await expect(asVisitor(() => resolveAssetContent(airappAssetId))).rejects.toThrow(
        /not found/i,
      );
      await expect(
        client.assets.readTextLines({ assetId: airappAssetId, startLine: 1, endLine: 20 }),
      ).resolves.toMatchObject({ lines: ["Deliberately shared file content"] });
    }
    await db
      .update(busabaseNodes)
      .set({ archivedAt: null, deletedAt: null })
      .where(eq(busabaseNodes.id, publicAliasFileId));
    await expect(
      asVisitor(() =>
        client.assets.readTextLines({ assetId: airappAssetId, startLine: 1, endLine: 20 }),
      ),
    ).resolves.toMatchObject({ lines: ["Deliberately shared file content"] });
  });

  it("rechecks inherited passwords and revocation on file, asset and detail reads", async () => {
    await setNodeShare(folderId, {
      scope: "public",
      capability: "read",
      password: "shared-folder-password",
    });
    await expect(asVisitor(() => client.nodes.get({ nodeId: htmlId }))).rejects.toThrow(
      /not found/i,
    );
    await expect(
      asVisitor(() => client.fileTrees.readFile({ nodeId: driveId, filePath: "README.md" })),
    ).rejects.toThrow(/not found/i);
    await expect(
      asVisitor(() =>
        client.assets.readTextLines({ assetId: fileAssetId, startLine: 1, endLine: 20 }),
      ),
    ).rejects.toThrow(/not found/i);
    const proof = await asVisitor(() => unlockPublicShare(folderId, "shared-folder-password"));
    if (!proof?.passwordVersion) throw new Error("Expected a valid folder password proof");
    const passwordVersion = proof.passwordVersion;
    const unlockedShareNodeIds = await asVisitor(() =>
      validatePublicShareUnlockProofs([{ nodeId: proof.nodeId, passwordVersion }]),
    );
    await expect(
      runWithAnonymousContext({ unlockedShareNodeIds }, () =>
        client.fileTrees.readFile({ nodeId: driveId, filePath: "README.md" }),
      ),
    ).resolves.toMatchObject({ nodeId: driveId });
    await disableNodeShare(folderId);
    await expect(
      runWithAnonymousContext({ unlockedShareNodeIds }, () =>
        client.fileTrees.readFile({ nodeId: driveId, filePath: "README.md" }),
      ),
    ).rejects.toThrow(/not found/i);
    await expect(
      asVisitor(() =>
        client.assets.readTextLines({ assetId: fileAssetId, startLine: 1, endLine: 20 }),
      ),
    ).rejects.toThrow(/not found/i);
  });
});
