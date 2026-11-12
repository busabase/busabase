import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("attachment completeness e2e: replace → dump blobs → package collect", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-att-e2e-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-att-e2e-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const { busabaseRouter: router } = await import("../src/router");
    client = createRouterClient(router);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    await Promise.all([
      dataDir ? rm(dataDir, { recursive: true, force: true }) : undefined,
      storageDir ? rm(storageDir, { recursive: true, force: true }) : undefined,
    ]);
  });

  it("keeps every attachment downloadable and package export complete after replaces", async () => {
    const airapp = await client.fileTrees.create({
      type: "airapp",
      autoMerge: true,
      slug: "completeness-airapp",
      name: "Completeness AirApp",
      files: [
        { path: "index.html", content: "<html>v1</html>" },
        { path: "config.js", content: "export const v = 1;\n" },
        { path: "SKILL.md", content: "# skill v1\n" },
      ],
    });
    if (!("node" in airapp)) throw new Error("expected immediate node");

    for (const content of ["v2", "v3"]) {
      const cr = await client.fileTrees.createChangeRequest({
        type: "airapp",
        nodeId: airapp.node.id,
        operations: [
          { kind: "update", path: "index.html", content: `<html>${content}</html>` },
          { kind: "update", path: "config.js", content: `export const v = '${content}';\n` },
        ],
        message: `bump ${content}`,
        submittedBy: "agent",
      });
      await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [cr.id] });
    }

    const attachments = await client.dump.exportTables({ table: "attachments", limit: 1000 });
    const assets = await client.dump.exportTables({ table: "assets", limit: 1000 });
    const assetAttachmentIds = new Set(assets.rows.map((row) => row.attachmentId as string));
    // After GC, every attachment row should still be reachable from an Asset.
    expect(attachments.rows.every((row) => assetAttachmentIds.has(row.id as string))).toBe(true);

    for (const row of attachments.rows) {
      const blob = await client.dump.exportAttachment({ attachmentId: row.id as string });
      expect(blob.storageKey).toBe(row.storageKey);
      expect(blob.downloadUrl).toEqual(expect.any(String));
      // Resolve local storage bytes via openlib in-process
      const { storage } = await import("openlib/storage");
      const bytes = await storage.getObject(blob.storageKey);
      expect(bytes.byteLength).toBeGreaterThan(0);
      if (typeof row.sizeBytes === "number") expect(bytes.byteLength).toBe(row.sizeBytes);
    }

    // Package collect path — every live file-tree path must download.
    const { collectPackageTree } = await import("busabase-package/collect");
    const tree = await collectPackageTree(
      client as never,
      {
        id: airapp.node.id,
        type: "airapp",
        slug: airapp.node.slug,
        name: airapp.node.name,
        description: "",
        position: 0,
        metadata: null,
      } as never,
      { warn: () => undefined },
    );
    const node = tree.nodes.find((entry) => entry.type === "airapp" && "files" in entry);
    if (!node || !("files" in node)) throw new Error("expected airapp package node");
    const paths = new Set(node.files.map((file) => file.path));
    expect(paths.has("index.html")).toBe(true);
    expect(paths.has("config.js")).toBe(true);
    expect(paths.has("SKILL.md")).toBe(true);
    const index = node.files.find((file) => file.path === "index.html");
    expect(index?.bytes.toString("utf8")).toContain("v3");
    const config = node.files.find((file) => file.path === "config.js");
    expect(config?.bytes.toString("utf8")).toContain("v3");
  });
});
