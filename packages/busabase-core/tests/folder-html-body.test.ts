import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { processStorageCleanupJobs } from "../src/domains/assets/logic/storage-cleanup-logic";
import { buildAssetContentUrl } from "../src/domains/assets/utils/asset-content-url";
import { folderReadmeHtmlKey, folderReadmeKey } from "../src/domains/folder/handlers";
import { busabaseRouter } from "../src/router";

/**
 * Folder HTML readme — the same optional readme as the Markdown one, written
 * with `bodyFormat: "html"` and stored at `…/folder/readme.html`. A folder
 * keeps one readme: the format is whichever object exists. Against a real oRPC
 * router + PGLite + local object storage.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const PAGE = '<!doctype html>\n<h1>How to use this folder</h1>\n<p class="lead">Start here.</p>\n';

describe("folder HTML readme — PUT/GET, format switch, storage keys", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let folderId = "";

  const readFolder = async () => {
    const detail = await client.nodes.get({ nodeId: folderId, type: "folder" });
    if (detail.type !== "folder") throw new Error("expected a folder detail");
    return detail;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-folder-html-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-folder-html-storage-"));
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
          slug: "html-readme-folder",
          name: "HTML Readme Folder",
          description: "header only",
        },
      ],
    });
    expect(created.status).toBe("merged");
    const tree = await client.nodes.list({});
    const flatten = (entries: typeof tree): typeof tree =>
      entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
    folderId = flatten(tree).find((node) => node.slug === "html-readme-folder")?.id ?? "";
    expect(folderId).not.toBe("");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("a folder with no readme reads as an empty Markdown readme", async () => {
    const detail = await readFolder();
    expect(detail.body).toBe("");
    expect(detail.bodyFormat).toBe("markdown");
  });

  it("bodyFormat: html merges to folder/readme.html and reads back as HTML", async () => {
    const cr = await client.nodes.updateContent({
      nodeId: folderId,
      content: { kind: "folder", body: PAGE, bodyFormat: "html" },
    });
    expect(cr.status).toBe("merged");
    expect(cr.primaryOperation?.operation).toBe("folder_update");

    await expect(storage.objectExists(folderReadmeHtmlKey(folderId))).resolves.toBe(true);
    await expect(storage.objectExists(folderReadmeKey(folderId))).resolves.toBe(false);
    // Raw source, not JSON — same reason an HTML node stores `index.html`.
    expect((await storage.getObject(folderReadmeHtmlKey(folderId))).toString("utf8")).toBe(PAGE);

    const detail = await readFolder();
    expect(detail.body).toBe(PAGE);
    expect(detail.bodyFormat).toBe("html");
    expect(detail.node.description).toBe("header only");
  });

  it("grep and readLines read the HTML object, not the absent Markdown one", async () => {
    const lines = await client.nodes.readLines({ nodeId: folderId, startLine: 2, endLine: 2 });
    expect(lines.lines).toEqual(["<h1>How to use this folder</h1>"]);

    const grep = await client.grep({
      pattern: 'class="lead"',
      sources: ["nodes"],
      scope: { nodes: { nodeIds: [folderId] } },
    });
    expect(grep.matches).toHaveLength(1);
    const match = grep.matches[0];
    if (!match || match.source !== "nodes") throw new Error("expected a nodes match");
    expect(match.type).toBe("folder");
    expect(match.nodeId).toBe(folderId);
  });

  it("an HTML readme shares the Doc body size cap", async () => {
    await expect(
      client.nodes.updateContent({
        nodeId: folderId,
        content: { kind: "folder", body: `<p>${"x".repeat(300_001)}</p>`, bodyFormat: "html" },
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect((await readFolder()).body).toBe(PAGE);
  });

  it("a review-first HTML write changes nothing until it merges", async () => {
    const pending = await client.nodes.updateContent({
      nodeId: folderId,
      autoMerge: false,
      content: { kind: "folder", body: "<h1>Proposed</h1>\n", bodyFormat: "html" },
    });
    expect(pending.status).toBe("in_review");
    expect((await readFolder()).body).toBe(PAGE);

    await client.changeRequests.review({ changeRequestIds: [pending.id], verdict: "approved" });
    const [merged] = (await client.changeRequests.merge({ changeRequestIds: [pending.id] }))
      .results;
    expect(merged?.ok).toBe(true);
    const detail = await readFolder();
    expect(detail.body).toBe("<h1>Proposed</h1>\n");
    expect(detail.bodyFormat).toBe("html");
  });

  it("a write without bodyFormat switches back to Markdown and removes the HTML object", async () => {
    const cr = await client.nodes.updateContent({
      nodeId: folderId,
      content: { kind: "folder", body: "# Back to Markdown\n" },
    });
    expect(cr.status).toBe("merged");

    await expect(storage.objectExists(folderReadmeKey(folderId))).resolves.toBe(true);
    await expect(storage.objectExists(folderReadmeHtmlKey(folderId))).resolves.toBe(false);
    const detail = await readFolder();
    expect(detail.body).toBe("# Back to Markdown\n");
    expect(detail.bodyFormat).toBe("markdown");

    // And to HTML again: the Markdown object goes the other way.
    await client.nodes.updateContent({
      nodeId: folderId,
      content: { kind: "folder", body: PAGE, bodyFormat: "html" },
    });
    await expect(storage.objectExists(folderReadmeKey(folderId))).resolves.toBe(false);
    expect((await readFolder()).bodyFormat).toBe("html");
  });

  it("registers an asset usage for an image the HTML readme embeds", async () => {
    const bytes = Buffer.alloc(99, "5e");
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const req = await client.assets.createUploadUrl({
      fileName: "html-readme.png",
      mimeType: "image/png",
      sizeBytes: 99,
      contentHash,
    });
    await storage.uploadFileToKey(bytes, req.storageKey, "image/png");
    await client.assets.confirm({
      storageKey: req.storageKey,
      fileName: "html-readme.png",
      mimeType: "image/png",
      sizeBytes: 99,
      contentHash,
    });
    const image = (await client.assets.list()).find((a) => a.contentHash === contentHash);
    if (!image) throw new Error("upload did not register an asset");

    await client.nodes.updateContent({
      nodeId: folderId,
      content: {
        kind: "folder",
        body: `<img src="${buildAssetContentUrl(image.id)}" alt="diagram">\n`,
        bodyFormat: "html",
      },
    });
    const usages = (await client.assets.get({ assetId: image.id })).usages;
    expect(usages.map((usage) => ({ nodeId: usage.nodeId, nodeType: usage.nodeType }))).toEqual([
      { nodeId: folderId, nodeType: "folder" },
    ]);
  });

  it("the backup export marks an HTML readme, and leaves a Markdown one unmarked", async () => {
    await client.nodes.updateContent({
      nodeId: folderId,
      content: { kind: "folder", body: PAGE, bodyFormat: "html" },
    });
    const doc = await client.docs.create({
      autoMerge: true,
      parentNodeId: folderId,
      slug: "html-readme-sibling",
      name: "Sibling",
      body: "# Sibling\n",
    });
    const exported = await client.dump.exportDocBodies({ nodeIds: [folderId, doc.node.id] });
    expect(exported.bodies).toEqual(
      expect.arrayContaining([
        { nodeId: folderId, markdown: PAGE, bodyFormat: "html" },
        { nodeId: doc.node.id, markdown: "# Sibling\n" },
      ]),
    );
    expect(exported.bodies).toHaveLength(2);
  });

  // Which readme object is live is not recorded anywhere, so a permanent
  // delete has to queue both — an HTML readme must not outlive its folder.
  it("permanently deleting a folder removes its HTML readme object", async () => {
    const rootId = (await client.nodes.list({}))[0]?.id ?? "";
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          parentNodeId: rootId,
          nodeType: "folder",
          slug: "html-readme-purge",
          name: "Purge Me",
        },
      ],
    });
    const tree = await client.nodes.list({});
    const purgeId = tree
      .flatMap((entry) => [entry, ...entry.children])
      .find((node) => node.slug === "html-readme-purge")?.id;
    if (!purgeId) throw new Error("expected the purge folder");
    await client.nodes.updateContent({
      nodeId: purgeId,
      content: { kind: "folder", body: PAGE, bodyFormat: "html" },
    });
    await expect(storage.objectExists(folderReadmeHtmlKey(purgeId))).resolves.toBe(true);

    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "delete", nodeId: purgeId }],
    });
    await expect(client.nodes.purge({ nodeId: purgeId })).resolves.toEqual({ purged: true });
    await processStorageCleanupJobs(await getDb(), { limit: 100 });

    await expect(storage.objectExists(folderReadmeHtmlKey(purgeId))).resolves.toBe(false);
    await expect(storage.objectExists(folderReadmeKey(purgeId))).resolves.toBe(false);
  });
});
