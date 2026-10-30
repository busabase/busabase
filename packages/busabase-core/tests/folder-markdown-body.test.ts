import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithAnonymousContext, runWithBusabaseContext } from "../src/context";
import { resolveAssetContent } from "../src/domains/assets/logic/asset-content-logic";
import { buildAssetContentUrl } from "../src/domains/assets/utils/asset-content-url";
import { docBodyKey } from "../src/domains/doc/handlers";
import { folderReadmeKey } from "../src/domains/folder/handlers";
import { setNodeShare } from "../src/logic/node-share";
import { busabaseRouter } from "../src/router";

/**
 * Folder Markdown body — optional readme on a folder node, stored like a Doc
 * body but at `busabase/nodes/{id}/folder/readme.md`. Against a real oRPC
 * router + PGLite + local object storage.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("folder markdown body — PUT/GET + storage key", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let folderId = "";
  let docId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-folder-body-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-folder-body-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const rootId = (await client.nodes.list({}))[0]?.id ?? "";
    expect(rootId).not.toBe("");
    const created = await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          parentNodeId: rootId,
          nodeType: "folder",
          slug: "readme-folder",
          name: "Readme Folder",
          description: "header only",
        },
      ],
    });
    expect(created.status).toBe("merged");
    const tree = await client.nodes.list({});
    const flatten = (entries: typeof tree): typeof tree =>
      entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
    folderId = flatten(tree).find((node) => node.slug === "readme-folder")?.id ?? "";
    expect(folderId).not.toBe("");

    const doc = await client.docs.create({
      autoMerge: true,
      parentNodeId: folderId,
      slug: "sibling-doc",
      name: "Sibling Doc",
      body: "# Sibling\n",
    });
    docId = doc.node.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("GET returns an empty body when no readme object exists", async () => {
    const detail = await client.nodes.get({ nodeId: folderId, type: "folder" });
    expect(detail.type).toBe("folder");
    if (detail.type !== "folder") throw new Error("expected a folder detail");
    expect(detail.body).toBe("");
    expect(detail.storagePrefix).toBe(`busabase/nodes/${folderId}/folder/`);
    expect(detail.node.description).toBe("header only");
    expect(detail.children.some((child) => child.id === docId)).toBe(true);
    await expect(storage.objectExists(folderReadmeKey(folderId))).resolves.toBe(false);
    await expect(storage.objectExists(docBodyKey(folderId))).resolves.toBe(false);
  });

  it("rejects a content kind that does not match the node type", async () => {
    await expect(
      client.nodes.updateContent({
        nodeId: folderId,
        content: { kind: "doc", body: "this is a doc write" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client.nodes.updateContent({
        nodeId: docId,
        content: { kind: "folder", body: "this is a folder write" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(storage.objectExists(folderReadmeKey(folderId))).resolves.toBe(false);
    await expect(storage.objectExists(folderReadmeKey(docId))).resolves.toBe(false);
    expect((await client.nodes.get({ nodeId: docId, type: "doc" })).body).toBe("# Sibling\n");
  });

  it("PUT { kind: folder } merges the readme to folder/readme.md, not doc/doc.md", async () => {
    const body = "# How to use this folder\n\nKeep the brief here.\n";
    const cr = await client.nodes.updateContent({
      nodeId: folderId,
      content: { kind: "folder", body },
    });
    expect(cr.status).toBe("merged");
    expect(cr.primaryOperation?.operation).toBe("folder_update");

    const readmeKey = folderReadmeKey(folderId);
    const docKey = docBodyKey(folderId);
    await expect(storage.objectExists(readmeKey)).resolves.toBe(true);
    await expect(storage.objectExists(docKey)).resolves.toBe(false);
    expect((await storage.getObject(readmeKey)).toString("utf8")).toBe(body);

    const detail = await client.nodes.get({ nodeId: folderId, type: "folder" });
    if (detail.type !== "folder") throw new Error("expected a folder detail");
    expect(detail.body).toBe(body);
    expect(detail.node.description).toBe("header only");
    expect(detail.children.some((child) => child.id === docId)).toBe(true);

    const lines = await client.nodes.readLines({
      nodeId: folderId,
      startLine: 1,
      endLine: 1,
    });
    expect(lines.lines).toEqual(["# How to use this folder"]);

    const grep = await client.grep({
      pattern: "Keep the brief",
      sources: ["nodes"],
      scope: { nodes: { nodeIds: [folderId] } },
    });
    expect(grep.matches).toHaveLength(1);
    const match = grep.matches[0];
    if (!match || match.source !== "nodes") throw new Error("expected a nodes match");
    expect(match.type).toBe("folder");
    expect(match.nodeId).toBe(folderId);
  });

  it("rejects a readme over the Doc body size cap before writing", async () => {
    const previous = await client.nodes.get({ nodeId: folderId, type: "folder" });
    if (previous.type !== "folder") throw new Error("expected a folder detail");
    await expect(
      client.nodes.updateContent({
        nodeId: folderId,
        content: { kind: "folder", body: "x".repeat(300_001) },
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    const detail = await client.nodes.get({ nodeId: folderId, type: "folder" });
    if (detail.type !== "folder") throw new Error("expected a folder detail");
    expect(detail.body).toBe(previous.body);
  });

  const uploadImage = async (fileName: string, contentHash: string) => {
    const req = await client.assets.createUploadUrl({
      fileName,
      mimeType: "image/png",
      sizeBytes: 99,
      contentHash,
    });
    await client.assets.confirm({
      storageKey: req.storageKey,
      fileName,
      mimeType: "image/png",
      sizeBytes: 99,
      contentHash,
    });
    const asset = (await client.assets.list()).find((a) => a.contentHash === contentHash);
    if (!asset) throw new Error(`upload of ${fileName} did not register an asset`);
    return asset;
  };

  // Asset reads are authorized through usage rows. Without one, an image in the
  // readme is readable only by its uploader and space managers, so a teammate
  // or a public-share visitor saw the readme's text and a broken image.
  it("an image in a publicly shared folder's readme loads for an anonymous visitor", async () => {
    const image = await uploadImage("readme-diagram.png", `sha256:${"3c".repeat(32)}`);
    const cr = await client.nodes.updateContent({
      nodeId: folderId,
      content: {
        kind: "folder",
        body: `# How to use this folder\n\n![diagram](${buildAssetContentUrl(image.id)})\n`,
      },
    });
    expect(cr.status).toBe("merged");

    const usages = (await client.assets.get({ assetId: image.id })).usages;
    expect(usages.map((usage) => ({ nodeId: usage.nodeId, nodeType: usage.nodeType }))).toEqual([
      { nodeId: folderId, nodeType: "folder" },
    ]);

    await runWithBusabaseContext({}, () =>
      setNodeShare(folderId, { scope: "public", capability: "read" }),
    );
    await runWithAnonymousContext({}, async () => {
      const content = await resolveAssetContent(image.id);
      expect(content.fileName).toBe("readme-diagram.png");
    });

    // Removing the embed drops the usage, same replace semantics as a Doc.
    await client.nodes.updateContent({
      nodeId: folderId,
      content: { kind: "folder", body: "# How to use this folder\n" },
    });
    expect((await client.assets.get({ assetId: image.id })).usages).toEqual([]);
    await runWithAnonymousContext({}, async () => {
      await expect(resolveAssetContent(image.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // Backups read bodies through `dump.exportDocBodies`. It used to match Docs
  // only, so a restore brought every readme back empty.
  it("the backup export carries a folder's readme, and omits a folder that has none", async () => {
    const rootId = (await client.nodes.list({}))[0]?.id ?? "";
    expect(await storage.objectExists(folderReadmeKey(rootId))).toBe(false);
    const exported = await client.dump.exportDocBodies({ nodeIds: [folderId, rootId, docId] });
    expect(new Map(exported.bodies.map((entry) => [entry.nodeId, entry.markdown]))).toEqual(
      new Map([
        [folderId, "# How to use this folder\n"],
        [docId, "# Sibling\n"],
      ]),
    );
  });
});
