import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { LocalStorage, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { attachments, busabaseAssets, busabaseNodes } from "../src/db/schema";
import { richNodeDocumentKey } from "../src/domains/rich-node/handlers";
import { busabaseRouter } from "../src/router";

describe("full dump coverage with real PGLite and object storage", () => {
  let originalCwd: string;
  let dataDir: string;
  let storageDir: string;
  const client = createRouterClient(busabaseRouter);
  const inSpace = <T>(spaceId: string, work: () => Promise<T>) =>
    runWithBusabaseContext({ spaceId }, work);
  const spaceId = "dump_coverage_a";
  const otherSpaceId = "dump_coverage_b";
  const body = Buffer.from("original <html>mail@example.com</html>\r\n", "utf8");
  const hash = `sha256:${createHash("sha256").update(body).digest("hex")}`;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-coverage-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-coverage-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    await inSpace(spaceId, () => client.nodes.list({}));
    const db = await getDb();
    await db.insert(attachments).values(
      [
        { id: "att_coverage_owned", spaceId, storageKey: "coverage/owned.html" },
        { id: "att_coverage_legacy", spaceId: null, storageKey: "coverage/legacy.html" },
        { id: "att_coverage_other", spaceId: otherSpaceId, storageKey: "coverage/other.html" },
        { id: "att_coverage_unrelated_null", spaceId: null, storageKey: "coverage/unrelated.html" },
      ].map((row) => ({
        ...row,
        userId: "coverage-user",
        fileName: "original.html",
        mimeType: "text/html",
        sizeBytes: body.length,
        contentHash: hash,
      })),
    );
    await db.insert(busabaseAssets).values([
      { id: "ast_coverage_legacy", spaceId, attachmentId: "att_coverage_legacy", name: "Legacy" },
      {
        id: "ast_coverage_other",
        spaceId: otherSpaceId,
        attachmentId: "att_coverage_other",
        name: "Other",
      },
    ]);
    // A malicious loose Asset pointer must not turn a foreign non-null
    // attachment registration into a same-space download capability.
    await db.insert(busabaseAssets).values({
      id: "ast_coverage_foreign_pointer",
      spaceId,
      attachmentId: "att_coverage_other",
      name: "Forbidden cross-space pointer",
    });
    for (const key of [
      "coverage/owned.html",
      "coverage/legacy.html",
      "coverage/other.html",
      "coverage/unrelated.html",
    ]) {
      await storage.uploadFileToKey(body, key, "text/html");
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) await rm(dir, { recursive: true, force: true });
  });

  it("paginates all owned physical rows plus referenced legacy rows, excluding other tenants", async () => {
    const ids: unknown[] = [];
    let cursor: string | undefined;
    do {
      const page = await inSpace(spaceId, () =>
        client.dump.exportTables({ table: "attachments", limit: 1, cursor }),
      );
      ids.push(...page.rows.map((row) => row.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toContain("att_coverage_owned");
    expect(ids).toContain("att_coverage_legacy");
    expect(ids).not.toContain("att_coverage_other");
    expect(ids).not.toContain("att_coverage_unrelated_null");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves direct byte URLs without requiring any Asset and rejects foreign/unknown rows", async () => {
    const sign = vi.spyOn(LocalStorage.prototype, "generatePresignedUrl");
    const owned = await inSpace(spaceId, () =>
      client.dump.exportAttachment({ attachmentId: "att_coverage_owned" }),
    );
    expect(sign).toHaveBeenCalledWith("coverage/owned.html");
    expect(owned).toMatchObject({
      attachmentId: "att_coverage_owned",
      storageKey: "coverage/owned.html",
      contentHash: hash,
      sizeBytes: body.length,
    });
    expect(await storage.getObject(owned.storageKey)).toEqual(body);
    expect(
      await inSpace(spaceId, () =>
        client.dump.exportAttachment({ attachmentId: "att_coverage_legacy" }),
      ),
    ).toMatchObject({ storageKey: "coverage/legacy.html" });
    for (const id of ["att_coverage_other", "att_coverage_unrelated_null", "att_missing"]) {
      await expect(
        inSpace(spaceId, () => client.dump.exportAttachment({ attachmentId: id })),
      ).rejects.toThrow(/not found/i);
    }
    await expect(
      runWithBusabaseContext({ spaceId, isSpaceManager: false }, () =>
        client.dump.exportAttachment({ attachmentId: "att_coverage_owned" }),
      ),
    ).rejects.toThrow(/owner\/admin/i);
    sign.mockRestore();
  });

  it("exports exact raw archived HTML/workflow bytes while omitting absent rich objects", async () => {
    const ids = await inSpace(spaceId, async () => {
      const root = (await client.nodes.list({}))[0].id;
      const cr = await client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            parentNodeId: root,
            nodeType: "html",
            slug: "coverage-html",
            name: "HTML",
          },
          {
            kind: "create",
            parentNodeId: root,
            nodeType: "workflow",
            slug: "coverage-workflow",
            name: "Workflow",
          },
          {
            kind: "create",
            parentNodeId: root,
            nodeType: "whiteboard",
            slug: "coverage-empty",
            name: "Empty",
          },
        ],
      });
      return cr.operations.map((operation) => operation.nodeId as string);
    });
    const workflow = '{\n  "version": 1, "nodes": [], "edges": []\n}\r\n';
    await storage.uploadFileToKey(body, richNodeDocumentKey(ids[0], "html"), "text/html");
    await storage.uploadFileToKey(
      Buffer.from(workflow),
      richNodeDocumentKey(ids[1], "workflow"),
      "application/json",
    );
    await (await getDb())
      .update(busabaseNodes)
      .set({ archivedAt: new Date() })
      .where(eq(busabaseNodes.id, ids[1]));
    const result = await inSpace(spaceId, () => client.dump.exportDocBodies({ nodeIds: ids }));
    expect(result.supportedRichNodeTypes).toEqual(["html", "whiteboard", "workflow"]);
    expect(result.bodies).toContainEqual({
      nodeId: ids[0],
      nodeType: "html",
      markdown: body.toString("utf8"),
    });
    expect(result.bodies).toContainEqual({
      nodeId: ids[1],
      nodeType: "workflow",
      markdown: workflow,
    });
    expect(result.bodies.some((entry) => entry.nodeId === ids[2])).toBe(false);
    expect(
      await inSpace(otherSpaceId, () => client.dump.exportDocBodies({ nodeIds: ids })),
    ).toMatchObject({ bodies: [] });
  });
  it("propagates a rich-object storage failure instead of inventing an empty document", async () => {
    const nodeId = await inSpace(spaceId, async () => {
      const root = (await client.nodes.list({}))[0].id;
      const result = await client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            parentNodeId: root,
            nodeType: "whiteboard",
            slug: "coverage-unreadable",
            name: "Unreadable",
          },
        ],
      });
      return result.operations[0].nodeId as string;
    });
    const read = vi
      .spyOn(LocalStorage.prototype, "getObject")
      .mockRejectedValueOnce(new Error("storage transport unavailable"));
    try {
      await expect(
        inSpace(spaceId, () => client.dump.exportDocBodies({ nodeIds: [nodeId] })),
      ).rejects.toThrow("storage transport unavailable");
    } finally {
      read.mockRestore();
    }
  });
});
