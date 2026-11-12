import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { busabaseRouter } from "../src/router";

/**
 * File-tree `update` used to repoint the mounted Asset onto new Attachment
 * bytes and leave the previous Attachment row behind forever. Workspace dumps
 * then listed those orphans; older backup CLIs that only walked Assets
 * published archives whose attachment rows had no bytes. Replacing a path
 * must release the previous Attachment once no Asset still references it.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("File-tree replace releases the previous Attachment", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-filetree-release-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-filetree-release-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const { busabaseRouter: router } = await import("../src/router");
    client = createRouterClient(router);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("drops the orphaned Attachment row after a content replace", async () => {
    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "release-previous-attachment-drive",
      name: "Release Previous Attachment Drive",
      files: [{ path: "notes.md", content: "revision one" }],
    });
    if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");

    const usagesBefore = await client.dump.exportTables({ table: "assetUsages", limit: 1000 });
    const usage = usagesBefore.rows.find(
      (row) => row.nodeId === drive.node.id && row.path === "notes.md",
    );
    expect(usage?.assetId).toEqual(expect.any(String));
    const assetsBefore = await client.dump.exportTables({ table: "assets", limit: 1000 });
    const mounted = assetsBefore.rows.find((row) => row.id === usage?.assetId);
    const previousAttachmentId = mounted?.attachmentId as string;
    expect(previousAttachmentId).toMatch(/^att/);
    const attachmentCountBefore = (
      await client.dump.exportTables({ table: "attachments", limit: 1000 })
    ).rows.length;

    const cr = await client.fileTrees.createChangeRequest({
      type: "drive",
      nodeId: drive.node.id,
      operations: [{ kind: "update", path: "notes.md", content: "revision two" }],
      message: "Replace notes",
      submittedBy: "agent",
    });
    await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [cr.id] });

    const assetsAfter = await client.dump.exportTables({ table: "assets", limit: 1000 });
    const remounted = assetsAfter.rows.find((row) => row.id === usage?.assetId);
    expect(remounted?.attachmentId).toEqual(expect.any(String));
    expect(remounted?.attachmentId).not.toBe(previousAttachmentId);

    const attachmentsAfter = await client.dump.exportTables({
      table: "attachments",
      limit: 1000,
    });
    // Net-zero growth: previous row released, replacement row kept.
    expect(attachmentsAfter.rows).toHaveLength(attachmentCountBefore);
    expect(attachmentsAfter.rows.some((row) => row.id === previousAttachmentId)).toBe(false);
    expect(attachmentsAfter.rows.some((row) => row.id === remounted?.attachmentId)).toBe(true);

    const file = await client.fileTrees.readFile({
      type: "drive",
      nodeId: drive.node.id,
      filePath: "notes.md",
    });
    expect(file.content).toBe("revision two");

    const { getDb } = await import("../src/db");
    const { attachments } = await import("../src/db/schema");
    const db = await getDb();
    const [ghost] = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.id, previousAttachmentId))
      .limit(1);
    expect(ghost).toBeUndefined();
  });
});
