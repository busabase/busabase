import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * The six operations that used to be pinned review-first for EVERY caller —
 * record delete/restore, field delete/convert, Base archive, mounted-asset
 * content edits, and file batches containing a delete. They are now
 * permission-aware like the rest of the write surface: an actor with `write`
 * on the target node gets the change applied in one call, and an explicit
 * `autoMerge: false` still forces review.
 *
 * Why this file exists: the old rule made a single person running their own
 * workspace approve their own cleanup — archive one duplicate record, then go
 * to the inbox and approve it yourself. Each case below asserts BOTH halves
 * (immediate by default, pending on `false`), because a change that only
 * loosened the default and quietly dropped the opt-out would be worse than the
 * behaviour it replaced.
 *
 * Runs through the real oRPC router against a real PGLite DB, same harness as
 * `asset-edit-content.test.ts` — a schema-only assertion would not catch a
 * logic layer that still hard-codes `in_review`.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const expectDefined = <T>(value: T | undefined | null): T => {
  expect(value).toBeDefined();
  if (value === undefined || value === null) throw new Error("Expected value to be defined");
  return value;
};

describe("destructive operations are permission-aware, not pinned review-first", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-destructive-am-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-destructive-am-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  /** A Base with a title + score field, created immediately. */
  const createBase = async (slug: string) =>
    client.bases.create({
      autoMerge: true,
      slug,
      name: slug,
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "score", name: "Score", type: "number" },
      ],
    });

  const createRecord = async (baseId: string, title: string) => {
    const created = await client.bases.createChangeRequest({
      baseId,
      fields: { title },
      autoMerge: true,
    });
    if (!created.materialized) throw new Error("Expected an immediate record");
    return created.id;
  };

  // ── records: delete / restore ─────────────────────────────────────────────
  it("archives and restores a record in one call each, and still honours autoMerge: false", async () => {
    const base = await createBase("dam-records");
    const recordId = await createRecord(base.id, "archive me");

    const archived = await client.records.changeRequest({ operation: "delete", recordId });
    expect(archived.materialized).toBe(true);
    expect((await client.records.list({ baseId: base.id })).records.map((r) => r.id)).not.toContain(
      recordId,
    );

    const restored = await client.records.changeRequest({ operation: "restore", recordId });
    expect(restored.materialized).toBe(true);
    expect((await client.records.list({ baseId: base.id })).records.map((r) => r.id)).toContain(
      recordId,
    );

    // The opt-out still works: the record is untouched and a CR is waiting.
    const pending = await client.records.changeRequest({
      operation: "delete",
      recordId,
      autoMerge: false,
    });
    expect(pending.materialized).toBe(false);
    if (pending.materialized) throw new Error("unreachable");
    expect(pending.status).toBe("in_review");
    expect((await client.records.list({ baseId: base.id })).records.map((r) => r.id)).toContain(
      recordId,
    );
  });

  // ── fields: delete / convert ──────────────────────────────────────────────
  it("deletes a field in one call, and still honours autoMerge: false", async () => {
    const base = await createBase("dam-field-delete");
    const scoreId = expectDefined(base.fields.find((f) => f.slug === "score")).id;

    const merged = await client.bases.fieldChangeRequest({
      operation: "delete",
      baseId: base.id,
      fieldId: scoreId,
    });
    expect(merged.status).toBe("merged");
    expect((await client.bases.get({ baseId: base.id })).fields.map((f) => f.slug)).not.toContain(
      "score",
    );

    // Restore it, then prove the opt-out.
    await client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: base.id,
      fieldId: scoreId,
    });
    const pending = await client.bases.fieldChangeRequest({
      operation: "delete",
      baseId: base.id,
      fieldId: scoreId,
      autoMerge: false,
    });
    expect(pending.status).toBe("in_review");
    expect((await client.bases.get({ baseId: base.id })).fields.map((f) => f.slug)).toContain(
      "score",
    );
  });

  it("converts a field's type in one call, and still honours autoMerge: false", async () => {
    const base = await createBase("dam-field-convert");
    const scoreId = expectDefined(base.fields.find((f) => f.slug === "score")).id;

    const merged = await client.bases.fieldChangeRequest({
      operation: "convert",
      baseId: base.id,
      fieldId: scoreId,
      newType: "text",
      selectChoiceMode: "null_on_missing",
    });
    expect(merged.status).toBe("merged");
    expect(
      expectDefined(
        (await client.bases.get({ baseId: base.id })).fields.find((f) => f.id === scoreId),
      ).type,
    ).toBe("text");

    const pending = await client.bases.fieldChangeRequest({
      operation: "convert",
      baseId: base.id,
      fieldId: scoreId,
      newType: "longtext",
      selectChoiceMode: "null_on_missing",
      autoMerge: false,
    });
    expect(pending.status).toBe("in_review");
    expect(
      expectDefined(
        (await client.bases.get({ baseId: base.id })).fields.find((f) => f.id === scoreId),
      ).type,
    ).toBe("text");
  });

  // ── Base archive ──────────────────────────────────────────────────────────
  it("archives a Base in one call, and still honours autoMerge: false", async () => {
    const archivable = await createBase("dam-base-archive");
    const merged = await client.bases.lifecycleChangeRequest({
      operation: "archive",
      baseId: archivable.id,
    });
    expect(merged.status).toBe("merged");
    expect((await client.bases.list({})).map((b) => b.id)).not.toContain(archivable.id);

    const kept = await createBase("dam-base-archive-pending");
    const pending = await client.bases.lifecycleChangeRequest({
      operation: "archive",
      baseId: kept.id,
      autoMerge: false,
    });
    expect(pending.status).toBe("in_review");
    expect((await client.bases.list({})).map((b) => b.id)).toContain(kept.id);
  });

  // ── file trees: a batch containing a delete ───────────────────────────────
  it("applies a file batch containing a delete in one call, instead of rejecting autoMerge", async () => {
    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "dam-drive-delete",
      name: "dam-drive-delete",
      files: [
        { path: "keep.md", content: "keep" },
        { path: "drop.md", content: "drop" },
      ],
    });
    if (!("node" in drive)) throw new Error("expected an immediate node");

    // Used to be a hard 400: "`autoMerge` is not accepted for a batch containing
    // a delete". Now it merges like any other batch.
    const merged = await client.fileTrees.createChangeRequest({
      type: "drive",
      nodeId: drive.node.id,
      operations: [{ kind: "delete", path: "drop.md" }],
      message: "Drop the stale note",
      autoMerge: true,
    });
    expect(merged.status).toBe("merged");
    const files = await client.fileTrees.listFiles({ type: "drive", nodeId: drive.node.id });
    expect(files.map((f) => f.path)).not.toContain("drop.md");

    const pending = await client.fileTrees.createChangeRequest({
      type: "drive",
      nodeId: drive.node.id,
      operations: [{ kind: "delete", path: "keep.md" }],
      message: "Propose dropping the kept note",
      autoMerge: false,
    });
    expect(pending.status).toBe("in_review");
    const stillThere = await client.fileTrees.listFiles({ type: "drive", nodeId: drive.node.id });
    expect(stillThere.map((f) => f.path)).toContain("keep.md");
  });

  // ── assets.editContent ────────────────────────────────────────────────────
  it("applies a mounted-file content edit in one call, and still honours autoMerge: false", async () => {
    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "dam-edit-content",
      name: "dam-edit-content",
      files: [{ path: "notes.md", content: "Hello ACME Corp." }],
    });
    if (!("node" in drive)) throw new Error("expected an immediate node");
    const assetId = expectDefined(drive.files.find((f) => f.path === "notes.md")).assetId;

    const merged = await client.assets.editContent({
      assetId,
      edits: [{ oldString: "ACME Corp", newString: "Umbrella Inc" }],
    });
    expect(merged.status).toBe("merged");
    expect(
      (
        await client.fileTrees.readFile({
          type: "drive",
          nodeId: drive.node.id,
          filePath: "notes.md",
        })
      ).content,
    ).toBe("Hello Umbrella Inc.");

    const pending = await client.assets.editContent({
      assetId,
      edits: [{ oldString: "Umbrella Inc", newString: "Initech" }],
      autoMerge: false,
    });
    expect(pending.status).toBe("in_review");
    expect(
      (
        await client.fileTrees.readFile({
          type: "drive",
          nodeId: drive.node.id,
          filePath: "notes.md",
        })
      ).content,
    ).toBe("Hello Umbrella Inc.");
  });
});
