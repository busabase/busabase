import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseAssetUsages } from "../src/db/schema";
import { busabaseRouter } from "../src/router";

/**
 * The `drive` field type end-to-end against a real PGLite database: a cell is
 * the same asset refs an `attachment` cell holds, plus a `path` per file. This
 * proves the parts a unit test cannot — the enum migration, validation on the
 * write path, the where-used index recording each file's path (the way a Drive
 * node does), and attachment ⇄ drive conversion rewriting real records.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const hash = (char: string) => `sha256:${char.repeat(64)}`;

describe("drive field — end-to-end", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-drive-field-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-drive-field-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "clients",
      name: "Clients",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "docs", name: "Docs", type: "drive", options: { attachment: { maxFiles: 5 } } },
        {
          slug: "files",
          name: "Files",
          type: "attachment",
          options: { attachment: { maxFiles: 9 } },
        },
      ],
      autoMerge: true,
    });
    baseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  /** Upload one file into the Asset library and return the ref a cell stores. */
  const upload = async (fileName: string, contentHash: string) => {
    const bytes = Buffer.alloc(42, contentHash);
    contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const req = await client.assets.createUploadUrl({
      fileName,
      mimeType: "image/png",
      sizeBytes: 42,
      contentHash,
    });
    await storage.uploadFileToKey(bytes, req.storageKey, "image/png");
    await client.assets.confirm({
      storageKey: req.storageKey,
      fileName,
      mimeType: "image/png",
      sizeBytes: 42,
      contentHash,
    });
    const asset = (await client.assets.list()).find((item) => item.contentHash === contentHash);
    if (!asset) throw new Error(`upload of ${fileName} did not reach the library`);
    return {
      id: asset.id,
      assetId: asset.id,
      attachmentId: asset.attachmentId,
      url: asset.url,
      fileName,
      mimeType: "image/png",
      size: 42,
    };
  };

  const mergeCr = async (crId: string) => {
    await client.changeRequests.review({ changeRequestIds: [crId], verdict: "approved" });
    const merged = await client.changeRequests.merge({ changeRequestIds: [crId] });
    const result = merged.results[0];
    if (!result?.ok) throw new Error(result?.error ?? "merge returned no result");
    return result;
  };

  const createRecord = async (fields: Record<string, unknown>) => {
    const cr = await client.bases.createChangeRequest({ baseId, fields, autoMerge: false });
    const result = await mergeCr(cr.id);
    if (!result.record) throw new Error("expected a created record");
    return result.record.id;
  };

  const updateRecord = async (recordId: string, fields: Record<string, unknown>) => {
    // With write access the update merges in the same call (the record comes back).
    await client.records.changeRequest({ operation: "update", recordId, fields, autoMerge: true });
  };

  /** The where-used rows of one record, as `fieldSlug:path:assetId`, sorted. */
  const usagesOf = async (recordId: string) => {
    const db = await getDb();
    const rows = await db
      .select({
        assetId: busabaseAssetUsages.assetId,
        fieldSlug: busabaseAssetUsages.fieldSlug,
        path: busabaseAssetUsages.path,
      })
      .from(busabaseAssetUsages)
      .where(
        and(eq(busabaseAssetUsages.recordId, recordId), eq(busabaseAssetUsages.ownerType, "base")),
      );
    return rows.map((row) => `${row.fieldSlug}:${row.path}:${row.assetId}`).sort();
  };

  it("stores files in folders, keeps every path, and indexes each file under its path", async () => {
    const a = await upload("a.png", hash("1"));
    const b = await upload("b.png", hash("2"));
    const c = await upload("c.png", hash("3"));
    const recordId = await createRecord({
      title: "Acme",
      docs: [
        { ...a, path: "contracts/2026/a.png" },
        { ...b, path: "invoices/b.png" },
        // A plain attachment ref (no path) is accepted and sits at the root.
        c,
      ],
    });

    const record = await client.records.get({ recordId });
    expect(
      (record.headCommit.payload.docs as Array<{ path?: string }>).map((ref) => ref.path),
    ).toEqual(["contracts/2026/a.png", "invoices/b.png", undefined]);
    expect(await usagesOf(recordId)).toEqual(
      [
        `docs:c.png:${c.assetId}`,
        `docs:contracts/2026/a.png:${a.assetId}`,
        `docs:invoices/b.png:${b.assetId}`,
      ].sort(),
    );

    // Moving a file into another folder re-indexes it under the new path.
    await updateRecord(recordId, {
      docs: [
        { ...a, path: "archive/a.png" },
        { ...b, path: "invoices/b.png" },
        { ...c, path: "c.png" },
      ],
    });
    expect(await usagesOf(recordId)).toEqual(
      [
        `docs:archive/a.png:${a.assetId}`,
        `docs:c.png:${c.assetId}`,
        `docs:invoices/b.png:${b.assetId}`,
      ].sort(),
    );

    // The asset library's "where used" surfaces the path too.
    const detail = await client.assets.get({ assetId: a.assetId });
    expect(detail.usages.find((usage) => usage.fieldSlug === "docs")?.path).toBe("archive/a.png");
  });

  it("rejects a cell whose paths a Drive would reject, before anything is proposed", async () => {
    const d = await upload("d.png", hash("4"));
    const e = await upload("e.png", hash("5"));
    const propose = (docs: unknown) =>
      client.bases.createChangeRequest({
        baseId,
        fields: { title: "Bad", docs },
        autoMerge: false,
      });

    await expect(propose([{ ...d, path: "../escape.png" }])).rejects.toThrow(/invalid file path/);
    await expect(propose([{ ...d, path: "/abs.png" }])).rejects.toThrow(/invalid file path/);
    await expect(
      propose([
        { ...d, path: "same.png" },
        { ...e, path: "same.png" },
      ]),
    ).rejects.toThrow(/more than one file at same\.png/);
    await expect(
      propose([
        { ...d, path: "docs" },
        { ...e, path: "docs/e.png" },
      ]),
    ).rejects.toThrow(/a file and a folder both named docs/);
    // The column's attachment limits apply to drive cells as well.
    await expect(
      propose(Array.from({ length: 6 }, (_, index) => ({ ...d, path: `f${index}.png` }))),
    ).rejects.toThrow(/at most 5 files/);
  });

  it("converts an attachment column to drive and back without losing a file", async () => {
    const first = await upload("dup.png", hash("6"));
    const second = await upload("dup.png", hash("7"));
    const recordId = await createRecord({ title: "Messy", files: [first, second] });
    const filesFieldId = (await client.bases.list({}))
      .find((base) => base.id === baseId)
      ?.fields.find((field) => field.slug === "files")?.id;
    if (!filesFieldId) throw new Error("files field missing");

    const preview = await client.bases.previewFieldConversion({
      baseId,
      fieldId: filesFieldId,
      newType: "drive",
    });
    expect(preview.conflicts).toEqual([]);

    const toDrive = await client.bases.fieldChangeRequest({
      operation: "convert",
      baseId,
      fieldId: filesFieldId,
      newType: "drive",
    });
    await mergeCr(toDrive.id);

    const field = (await client.bases.list({}))
      .find((base) => base.id === baseId)
      ?.fields.find((item) => item.slug === "files");
    expect(field?.type).toBe("drive");
    // Same files, same limits.
    expect(field?.options.attachment).toEqual({ maxFiles: 9 });
    const asDrive = (await client.records.get({ recordId })).headCommit.payload.files as Array<{
      assetId: string;
      path: string;
    }>;
    expect(asDrive.map((ref) => [ref.assetId, ref.path])).toEqual([
      [first.assetId, "dup.png"],
      [second.assetId, "dup (2).png"],
    ]);
    expect(await usagesOf(recordId)).toEqual(
      [`files:dup.png:${first.assetId}`, `files:dup (2).png:${second.assetId}`].sort(),
    );

    const toAttachment = await client.bases.fieldChangeRequest({
      operation: "convert",
      baseId,
      fieldId: filesFieldId,
      newType: "attachment",
    });
    await mergeCr(toAttachment.id);
    const back = (await client.records.get({ recordId })).headCommit.payload.files as Array<
      Record<string, unknown>
    >;
    expect(back.map((ref) => ref.assetId)).toEqual([first.assetId, second.assetId]);
    expect(back.some((ref) => "path" in ref)).toBe(false);
    expect(await usagesOf(recordId)).toEqual(
      [`files::${first.assetId}`, `files::${second.assetId}`].sort(),
    );
  });

  it("still refuses to turn a drive column into text", async () => {
    const docsFieldId = (await client.bases.list({}))
      .find((base) => base.id === baseId)
      ?.fields.find((field) => field.slug === "docs")?.id;
    if (!docsFieldId) throw new Error("docs field missing");
    await expect(
      client.bases.fieldChangeRequest({
        operation: "convert",
        baseId,
        fieldId: docsFieldId,
        newType: "text",
      }),
    ).rejects.toThrow();
  });
});
