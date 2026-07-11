import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { attachments, busabaseAssets, busabaseAssetUsages, busabaseNodes } from "../src/db/schema";
import { busabaseAssetTexts } from "../src/domains/assets/schema/asset-texts";
import { busabaseRouter } from "../src/router";

/**
 * Drive Grep Retrieval integration coverage — driven through the real oRPC
 * router (mirrors `assets-orpc.test.ts`'s harness) so tests exercise the
 * exact request → confirm/putText → grep/readLines code paths a caller hits.
 * See apps/busabase/content/spec/drive-grep-retrieval.md.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

const expectDefined = <T>(value: T | undefined | null): T => {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  if (value === undefined || value === null) throw new Error("Expected value to be defined");
  return value;
};

describe("Drive Grep Retrieval — putText / grep / readLines", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-storage-"));
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

  /** Upload+confirm a small asset, returning its assetId + attachmentId. */
  const uploadAsset = async (opts: {
    fileName: string;
    mimeType: string;
    hashByte: string;
    sizeBytes?: number;
  }) => {
    const contentHash = HASH(opts.hashByte);
    const req = await client.assets.createUploadUrl({
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      sizeBytes: opts.sizeBytes ?? 100,
      contentHash,
    });
    const confirmed = await client.assets.confirm({
      storageKey: req.storageKey,
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      sizeBytes: opts.sizeBytes ?? 100,
      contentHash,
    });
    return { assetId: expectDefined(confirmed.assetId), attachmentId: confirmed.attachmentId };
  };

  const getTextRow = async (assetId: string) => {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.assetId, assetId))
      .limit(1);
    return row;
  };

  describe("putText — inline", () => {
    it("writes text, dedupes identical re-supply, and updates on different text", async () => {
      const { assetId } = await uploadAsset({
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        hashByte: "1",
      });

      const first = await client.assets.putText({ assetId, text: "Hello ACME Corp v1" });
      expect(first.textStatus).toBe("present");
      expect(first.lineCount).toBe(1);
      const row1 = expectDefined(await getTextRow(assetId));
      expect(row1.writtenBy).not.toBe("auto");
      expect(row1.status).toBe("present");

      // Identical re-supply — idempotent, same hash, no error.
      const again = await client.assets.putText({ assetId, text: "Hello ACME Corp v1" });
      expect(again.textStatus).toBe("present");
      const row2 = expectDefined(await getTextRow(assetId));
      expect(row2.textContentHash).toBe(row1.textContentHash);
      expect(row2.id).toBe(row1.id); // updated in place, not a new row

      // Different text — row updates to the new hash; old object GC'd if unreferenced.
      const oldKey = row1.textStorageKey;
      await client.assets.putText({ assetId, text: "Different content entirely" });
      const row3 = expectDefined(await getTextRow(assetId));
      expect(row3.textContentHash).not.toBe(row1.textContentHash);
      await expect(storage.getObject(oldKey)).rejects.toThrow();
    });

    it("rejects inline text over the 1MB cap, pointing at the presigned path", async () => {
      const { assetId } = await uploadAsset({
        fileName: "huge.pdf",
        mimeType: "application/pdf",
        hashByte: "2",
      });
      const huge = "a".repeat(1024 * 1024 + 10);
      await expect(client.assets.putText({ assetId, text: huge })).rejects.toThrow(/1MB|limit/i);
    });

    it("marks none, and grep reports it as unsearchable (not missing)", async () => {
      const { assetId } = await uploadAsset({
        fileName: "scanned.pdf",
        mimeType: "application/pdf",
        hashByte: "3",
      });
      const result = await client.assets.putText({ assetId, none: true });
      expect(result.textStatus).toBe("none");
      const row = expectDefined(await getTextRow(assetId));
      expect(row.status).toBe("none");

      const grep = await client.assets.grep({
        pattern: "anything",
        scope: { assetIds: [assetId] },
      });
      expect(grep.missing).not.toContain(assetId);
      expect(grep.unsearchable).toBeGreaterThanOrEqual(1);
    });

    it("overrides an auto-registered text-kind row, flipping writtenBy away from auto", async () => {
      const { assetId } = await uploadAsset({
        fileName: "legacy.csv",
        mimeType: "text/csv",
        hashByte: "4",
      });
      const auto = expectDefined(await getTextRow(assetId));
      expect(auto.writtenBy).toBe("auto");

      await client.assets.putText({ assetId, text: "transcoded,utf8,content" });
      const overridden = expectDefined(await getTextRow(assetId));
      expect(overridden.writtenBy).not.toBe("auto");
    });
  });

  describe("putText — presigned (storageKey bind)", () => {
    it("binds a presigned upload: computes the real hash, content-addresses it, deletes the temp object", async () => {
      const { assetId } = await uploadAsset({
        fileName: "presigned.pdf",
        mimeType: "application/pdf",
        hashByte: "6",
      });
      const text = "Termination Clause: ACME Corp may terminate for convenience.\n".repeat(50);
      const bytes = Buffer.from(text, "utf8");

      const upload = await client.assets.createTextUploadUrl({ assetId, sizeBytes: bytes.length });
      await storage.uploadFileToKey(bytes, upload.storageKey, "text/plain");

      const result = await client.assets.putText({ assetId, storageKey: upload.storageKey });
      expect(result.textStatus).toBe("present");
      expect(result.lineCount).toBe(50);

      // Temp object is gone; content lives at the content-addressed key.
      await expect(storage.getObject(upload.storageKey)).rejects.toThrow();
      const row = expectDefined(await getTextRow(assetId));
      expect(row.textStorageKey).toMatch(/^asset-texts\/blobs\/sha256\//);
      await expect(storage.getObject(row.textStorageKey)).resolves.toBeInstanceOf(Buffer);
    });

    it("rejects a claimed contentHash that does not match the actual bytes", async () => {
      const { assetId } = await uploadAsset({
        fileName: "mismatch.pdf",
        mimeType: "application/pdf",
        hashByte: "7",
      });
      const bytes = Buffer.from("real content", "utf8");
      const upload = await client.assets.createTextUploadUrl({ assetId, sizeBytes: bytes.length });
      await storage.uploadFileToKey(bytes, upload.storageKey, "text/plain");

      await expect(
        client.assets.putText({
          assetId,
          storageKey: upload.storageKey,
          contentHash: HASH("f"),
        }),
      ).rejects.toThrow(/hash/i);
    });

    it("rejects invalid UTF-8 bytes", async () => {
      const { assetId } = await uploadAsset({
        fileName: "binary-mistake.pdf",
        mimeType: "application/pdf",
        hashByte: "8",
      });
      // A lone continuation byte — never valid UTF-8.
      const bytes = Buffer.from([0x48, 0x69, 0x80, 0x80]);
      const upload = await client.assets.createTextUploadUrl({ assetId, sizeBytes: bytes.length });
      await storage.uploadFileToKey(bytes, upload.storageKey, "text/plain");

      await expect(
        client.assets.putText({ assetId, storageKey: upload.storageKey }),
      ).rejects.toThrow(/utf-8/i);
    });

    it("only rejects a storageKey outside the pending prefix", async () => {
      const { assetId } = await uploadAsset({
        fileName: "wrong-prefix.pdf",
        mimeType: "application/pdf",
        hashByte: "9",
      });
      await expect(
        client.assets.putText({ assetId, storageKey: "attachments/blobs/sha256/aa/x.txt" }),
      ).rejects.toThrow();
    });
  });

  describe("GC — text objects are reference-counted", () => {
    it("keeps the shared object until the last referencing row is gone", async () => {
      const { assetId: assetA } = await uploadAsset({
        fileName: "shared-a.pdf",
        mimeType: "application/pdf",
        hashByte: "a",
      });
      const { assetId: assetB } = await uploadAsset({
        fileName: "shared-b.pdf",
        mimeType: "application/pdf",
        hashByte: "b",
      });
      const sharedText = "Shared derived text, supplied for two different assets.";

      await client.assets.putText({ assetId: assetA, text: sharedText });
      await client.assets.putText({ assetId: assetB, text: sharedText });
      const rowA = expectDefined(await getTextRow(assetA));
      const rowB = expectDefined(await getTextRow(assetB));
      expect(rowA.textContentHash).toBe(rowB.textContentHash);
      const sharedKey = rowA.textStorageKey;

      await client.assets.putText({ assetId: assetA, none: true });
      await expect(storage.getObject(sharedKey)).resolves.toBeInstanceOf(Buffer);

      await client.assets.putText({ assetId: assetB, none: true });
      await expect(storage.getObject(sharedKey)).rejects.toThrow();
    });

    it("GCs a derived text blob when its owning asset is deleted", async () => {
      // Regression: `busabase_asset_texts.assetId` cascade-deletes with the
      // asset, but nothing else ever garbage-collected the derived-text
      // object that row pointed at — `gcTextObjectIfUnreferenced` was only
      // ever called from `putAssetText` / `handleAssetAttachmentRepoint`,
      // never from any delete path, so the blob leaked forever.
      const { assetId } = await uploadAsset({
        fileName: "delete-me.pdf",
        mimeType: "application/pdf",
        hashByte: "0",
      });
      await client.assets.putText({ assetId, text: "Text that should be GC'd on asset delete" });
      const row = expectDefined(await getTextRow(assetId));
      const textKey = row.textStorageKey;
      await expect(storage.getObject(textKey)).resolves.toBeInstanceOf(Buffer);

      await client.assets.delete({ assetId });

      await expect(storage.getObject(textKey)).rejects.toThrow();
    });
  });

  describe("Auto-registration on confirm + lazy self-heal", () => {
    it("registers an auto row for a text-kind upload, and none for a binary upload", async () => {
      const { assetId: textAssetId } = await uploadAsset({
        fileName: "notes.md",
        mimeType: "text/markdown",
        hashByte: "c",
      });
      const textRow = expectDefined(await getTextRow(textAssetId));
      expect(textRow.status).toBe("present");
      expect(textRow.writtenBy).toBe("auto");

      const { assetId: binaryAssetId } = await uploadAsset({
        fileName: "photo.png",
        mimeType: "image/png",
        hashByte: "d",
      });
      expect(await getTextRow(binaryAssetId)).toBeUndefined();
    });

    it("lazily self-heals a pre-existing text-kind asset with no row when grep lists it", async () => {
      // Simulate an asset from before this feature shipped: insert Attachment +
      // Asset rows directly (bypassing confirmAssetUpload), with real bytes.
      const db = await getDb();
      const storageKey = "attachments/blobs/sha256/legacy/pre-existing.csv";
      await storage.uploadFileToKey(
        Buffer.from("id,value\n1,SelfHealMarkerXYZ\n", "utf8"),
        storageKey,
        "text/csv",
      );
      const [attachment] = await db
        .insert(attachments)
        .values({
          storageKey,
          fileName: "pre-existing.csv",
          mimeType: "text/csv",
          sizeBytes: 30,
          userId: "local",
        })
        .returning({ id: attachments.id });
      const attachmentId = expectDefined(attachment).id;
      const [asset] = await db
        .insert(busabaseAssets)
        .values({
          id: `ast_legacy_${Date.now()}`,
          attachmentId,
          name: "pre-existing.csv",
          contentKind: "text",
        })
        .returning({ id: busabaseAssets.id });
      const assetId = expectDefined(asset).id;

      expect(await getTextRow(assetId)).toBeUndefined();

      const grep = await client.assets.grep({
        pattern: "SelfHealMarkerXYZ",
        scope: { assetIds: [assetId] },
      });
      expect(grep.matches).toHaveLength(1);
      expect(grep.matches[0]?.assetId).toBe(assetId);

      // The self-heal is persisted — a row now exists.
      const healed = expectDefined(await getTextRow(assetId));
      expect(healed.writtenBy).toBe("auto");
      expect(healed.status).toBe("present");
    });
  });

  describe("grep", () => {
    it("finds literal matches with correct line/column, honoring maxMatches and context lines", async () => {
      const { assetId } = await uploadAsset({
        fileName: "multi-hit.log",
        mimeType: "text/plain",
        hashByte: "e",
      });
      const lines = [
        "before line 1",
        "before line 2",
        "ERROR: disk full",
        "after line 1",
        "after line 2",
      ];
      await client.assets.putText({ assetId, text: lines.join("\n") });

      const result = await client.assets.grep({
        pattern: "ERROR",
        scope: { assetIds: [assetId] },
        contextLines: 2,
      });
      expect(result.matches).toHaveLength(1);
      const match = expectDefined(result.matches[0]);
      expect(match.line).toBe(3);
      expect(match.column).toBe(1);
      expect(match.text).toBe("ERROR: disk full");
      expect(match.before).toEqual(["before line 1", "before line 2"]);
      expect(match.after).toEqual(["after line 1", "after line 2"]);
    });

    it("supports regex + case-insensitive flag", async () => {
      const { assetId } = await uploadAsset({
        fileName: "case.log",
        mimeType: "text/plain",
        hashByte: "1",
      });
      await client.assets.putText({ assetId, text: "Order-2024 shipped\norder-2025 pending" });

      const caseSensitive = await client.assets.grep({
        pattern: "^order-\\d+",
        scope: { assetIds: [assetId] },
      });
      expect(caseSensitive.matches).toHaveLength(1);
      expect(caseSensitive.matches[0]?.line).toBe(2);

      const caseInsensitive = await client.assets.grep({
        pattern: "^order-\\d+",
        flags: "i",
        scope: { assetIds: [assetId] },
      });
      expect(caseInsensitive.matches).toHaveLength(2);
    });

    it("computes correct line/column for multi-byte CJK content", async () => {
      const { assetId } = await uploadAsset({
        fileName: "cjk.log",
        mimeType: "text/plain",
        hashByte: "2",
      });
      // "你好" (2 chars) then the match starts at char index 2 (0-based) → column 3.
      await client.assets.putText({ assetId, text: "你好世界，ACME公司在此" });

      const result = await client.assets.grep({ pattern: "ACME", scope: { assetIds: [assetId] } });
      expect(result.matches).toHaveLength(1);
      const match = expectDefined(result.matches[0]);
      expect(match.line).toBe(1);
      expect(match.column).toBe("你好世界，".length + 1);
    });

    it("truncates at maxMatches and reports truncated: true", async () => {
      const { assetId } = await uploadAsset({
        fileName: "many-hits.log",
        mimeType: "text/plain",
        hashByte: "3",
      });
      const text = Array.from({ length: 20 }, (_, i) => `hit number ${i}`).join("\n");
      await client.assets.putText({ assetId, text });

      const result = await client.assets.grep({
        pattern: "hit",
        scope: { assetIds: [assetId] },
        maxMatches: 5,
      });
      expect(result.matches).toHaveLength(5);
      expect(result.truncated).toBe(true);
    });

    it("guards against pathologically long single lines — still matches, snippet truncates", async () => {
      const { assetId } = await uploadAsset({
        fileName: "long-line.log",
        mimeType: "text/plain",
        hashByte: "4",
      });
      const longLine = `${"x".repeat(1000)}NEEDLE${"y".repeat(70_000)}`;
      await client.assets.putText({ assetId, text: longLine });

      const result = await client.assets.grep({
        pattern: "NEEDLE",
        scope: { assetIds: [assetId] },
      });
      expect(result.matches).toHaveLength(1);
      const match = expectDefined(result.matches[0]);
      expect(match.text.length).toBeLessThan(longLine.length);
      expect(match.text.endsWith("…")).toBe(true);
    });

    it("reports a scan failure explicitly in `errored`, never silently as a clean scan", async () => {
      // Regression: a bare `try { ... } catch {}` around the per-file scan
      // used to swallow storage errors (corrupt cache, deleted mid-flight,
      // etc.) entirely — the asset still counted toward `filesScanned` as if
      // it had been cleanly searched with no match, with zero indication it
      // was never actually scanned. Force that failure mode by pointing a
      // `present`-status row's textStorageKey at an object that doesn't exist.
      const { assetId } = await uploadAsset({
        fileName: "corrupt-source.log",
        mimeType: "text/plain",
        hashByte: "0",
      });
      await client.assets.putText({ assetId, text: "a needle in a haystack" });
      const db = await getDb();
      await db
        .update(busabaseAssetTexts)
        .set({ textStorageKey: "asset-texts/blobs/sha256/zz/does-not-exist.txt" })
        .where(eq(busabaseAssetTexts.assetId, assetId));

      const result = await client.assets.grep({
        pattern: "needle",
        scope: { assetIds: [assetId] },
      });
      expect(result.matches).toHaveLength(0);
      expect(result.filesScanned).toBe(0);
      expect(result.errored).toContain(assetId);
    });

    it("falls back to the asset's own name when a file_node usage has no mounted path", async () => {
      // Regression: `loadDisplayInfo` derived fileName as
      // `metadata.displayName ?? path.split("/").at(-1)`. A `file_node`-type
      // usage (a Files-folder upload — same shape the demo fixture seeds) has
      // no mounted path (`path: ""`), so `"".split("/").at(-1)` resolved to
      // `""` rather than `undefined` — an empty string that then WON over
      // `displayFor`'s fallback (which only triggered on a missing map entry,
      // not a falsy fileName), leaving every grep match on such an asset
      // reporting a blank file name. Found via a real `pnpm db:seed:all` run.
      const { assetId } = await uploadAsset({
        fileName: "receipt.pdf",
        mimeType: "application/pdf",
        hashByte: "f",
      });
      await client.assets.putText({ assetId, text: "Vendor: Umbrella Supplies" });
      const db = await getDb();
      const nodeId = "nod_test_file_node_display";
      await db.insert(busabaseNodes).values({
        id: nodeId,
        parentId: null,
        type: "file",
        slug: "receipt-display-test",
        name: "Receipt",
        metadata: { assetId },
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.insert(busabaseAssetUsages).values({
        id: "aus_test_file_node_display",
        assetId,
        ownerType: "file_node",
        nodeId,
        path: "",
        recordId: "",
        fieldSlug: "file:asset",
        blockId: "",
        metadata: {},
      });

      const result = await client.assets.grep({
        pattern: "Umbrella",
        scope: { assetIds: [assetId] },
      });
      expect(result.matches).toHaveLength(1);
      expect(expectDefined(result.matches[0]).fileName).toBe("receipt.pdf");
    });

    it("reports missing for a binary asset with no text yet", async () => {
      const { assetId } = await uploadAsset({
        fileName: "unwritten.pdf",
        mimeType: "application/pdf",
        hashByte: "5",
      });
      const result = await client.assets.grep({
        pattern: "anything",
        scope: { assetIds: [assetId] },
      });
      expect(result.missing).toContain(assetId);
      expect(result.matches).toHaveLength(0);
    });

    it("returns partial results with truncated: true when the wall-clock budget is exhausted", async () => {
      const { assetId: a1 } = await uploadAsset({
        fileName: "deadline-1.log",
        mimeType: "text/plain",
        hashByte: "6",
      });
      const { assetId: a2 } = await uploadAsset({
        fileName: "deadline-2.log",
        mimeType: "text/plain",
        hashByte: "7",
      });
      await client.assets.putText({ assetId: a1, text: "needle one\nfiller" });
      await client.assets.putText({ assetId: a2, text: "needle two\nfiller" });

      const previous = process.env.BUSABASE_GREP_TIMEOUT_MS;
      process.env.BUSABASE_GREP_TIMEOUT_MS = "0";
      try {
        const result = await client.assets.grep({
          pattern: "needle",
          scope: { assetIds: [a1, a2] },
        });
        expect(result.truncated).toBe(true);
        // With a zero-budget deadline, at most the first candidate is scanned
        // before the wall-clock check trips — never both, never a hang.
        expect(result.filesScanned).toBeLessThanOrEqual(1);
      } finally {
        if (previous === undefined) delete process.env.BUSABASE_GREP_TIMEOUT_MS;
        else process.env.BUSABASE_GREP_TIMEOUT_MS = previous;
      }
    });
  });

  describe("readLines", () => {
    it("returns the exact requested line range, clamped and reported honestly", async () => {
      const { assetId } = await uploadAsset({
        fileName: "ranged.log",
        mimeType: "text/plain",
        hashByte: "6",
      });
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
      await client.assets.putText({ assetId, text: lines.join("\n") });

      const result = await client.assets.readTextLines({ assetId, startLine: 10, endLine: 15 });
      expect(result.lines).toEqual([
        "line 10",
        "line 11",
        "line 12",
        "line 13",
        "line 14",
        "line 15",
      ]);
      expect(result.totalLines).toBe(50);
      expect(result.truncated).toBe(false);
    });

    it("clamps a range that runs past EOF", async () => {
      const { assetId } = await uploadAsset({
        fileName: "short.log",
        mimeType: "text/plain",
        hashByte: "7",
      });
      await client.assets.putText({ assetId, text: "a\nb\nc" });

      const result = await client.assets.readTextLines({ assetId, startLine: 1, endLine: 10 });
      expect(result.lines).toEqual(["a", "b", "c"]);
      expect(result.totalLines).toBe(3);
    });

    it("reports truncated: false when the requested range reaches exactly EOF", async () => {
      // Regression: `completedRequestedRange` was only ever set `true` inside
      // the scan loop when a yielded line satisfied `currentLine > clampedEnd`
      // — but a read to EOF (`clampedEnd === totalLines`) makes the async
      // generator simply end after the last line, with no further line ever
      // offered to trigger that check, so a fully successful full-file read
      // used to come back `truncated: true`.
      const { assetId } = await uploadAsset({
        fileName: "exact-eof.log",
        mimeType: "text/plain",
        hashByte: "0",
      });
      const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
      await client.assets.putText({ assetId, text: lines.join("\n") });

      const result = await client.assets.readTextLines({ assetId, startLine: 1, endLine: 12 });
      expect(result.lines).toHaveLength(12);
      expect(result.totalLines).toBe(12);
      expect(result.truncated).toBe(false);
    });

    it("caps the range at 2000 lines", async () => {
      const { assetId } = await uploadAsset({
        fileName: "big.log",
        mimeType: "text/plain",
        hashByte: "8",
      });
      const lines = Array.from({ length: 3000 }, (_, i) => `l${i}`);
      await client.assets.putText({ assetId, text: lines.join("\n") });

      const result = await client.assets.readTextLines({ assetId, startLine: 1, endLine: 3000 });
      expect(result.lines.length).toBeLessThanOrEqual(2000);
    });

    it("grep → readLines loop: the reported match line matches the read-back content", async () => {
      const { assetId } = await uploadAsset({
        fileName: "loop.log",
        mimeType: "text/plain",
        hashByte: "9",
      });
      const lines = Array.from({ length: 30 }, (_, i) =>
        i === 20 ? "NEEDLE-HERE" : `filler ${i}`,
      );
      await client.assets.putText({ assetId, text: lines.join("\n") });

      const grep = await client.assets.grep({
        pattern: "NEEDLE-HERE",
        scope: { assetIds: [assetId] },
      });
      const match = expectDefined(grep.matches[0]);
      const read = await client.assets.readTextLines({
        assetId,
        startLine: match.line,
        endLine: match.line,
      });
      expect(read.lines[0]).toBe("NEEDLE-HERE");
    });
  });

  describe("schema — byteCount/lineCount/charCount survive files beyond 32-bit int range", () => {
    it("persists a byteCount past Postgres `integer`'s ~2.147B ceiling without erroring", async () => {
      // Regression: these columns used to be plain Postgres `integer`
      // (max ~2.147B), but the spec's own Failure Scenario Matrix names a
      // "5 GB CSV" as an expected use case — writing that real byteCount
      // would fail with a Postgres "value out of range for type integer"
      // error. Simulate the checkpoint-computation write directly (a real
      // 5GB fixture isn't practical in a unit test) — this exercises the
      // exact DB write path/column type, not just the JS-level value.
      const { assetId } = await uploadAsset({
        fileName: "huge.csv",
        mimeType: "text/csv",
        hashByte: "0",
      });
      const db = await getDb();
      const overInt32 = 3_000_000_000; // ~3GB — comfortably past 2^31-1 (2,147,483,647)
      await db
        .update(busabaseAssetTexts)
        .set({ byteCount: overInt32, lineCount: overInt32, charCount: overInt32 })
        .where(eq(busabaseAssetTexts.assetId, assetId));

      const row = expectDefined(await getTextRow(assetId));
      expect(row.byteCount).toBe(overInt32);
      expect(row.lineCount).toBe(overInt32);
      expect(row.charCount).toBe(overInt32);
    });
  });

  describe("Staleness on attachmentId repoint (Drive file-tree replace)", () => {
    it("flips a derived-text asset to stale on repoint, excluding it from grep, until rewritten", async () => {
      const { assetId: pdfAssetId } = await uploadAsset({
        fileName: "contract-v1.pdf",
        mimeType: "application/pdf",
        hashByte: "1",
      });
      await client.assets.putText({ assetId: pdfAssetId, text: "ACME Corp contract version one" });
      const beforeRepoint = expectDefined(await getTextRow(pdfAssetId));
      expect(beforeRepoint.status).toBe("present");

      const drive = await client.drives.create({
        autoMerge: true,
        slug: "stale-repoint-drive",
        name: "Stale Repoint Drive",
        files: [{ path: "contract.pdf", assetId: pdfAssetId }],
      });
      if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");

      const { assetId: replacementAssetId } = await uploadAsset({
        fileName: "contract-v2.pdf",
        mimeType: "application/pdf",
        hashByte: "2",
      });
      const cr = await client.drives.createChangeRequest({
        nodeId: drive.node.id,
        operations: [{ kind: "update", path: "contract.pdf", assetId: replacementAssetId }],
        message: "Replace contract with v2",
        submittedBy: "agent",
      });
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: cr.id });

      // The mounted asset id at that path is stable (pdfAssetId) — only its
      // attachmentId repoints. Its OLD derived text is now stale.
      const afterRepoint = expectDefined(await getTextRow(pdfAssetId));
      expect(afterRepoint.status).toBe("stale");

      const grep = await client.assets.grep({
        pattern: "ACME",
        scope: { assetIds: [pdfAssetId] },
      });
      expect(grep.matches).toHaveLength(0);
      expect(grep.stale).toContain(pdfAssetId);

      // Rewriting the text brings it back to present and greppable again.
      await client.assets.putText({ assetId: pdfAssetId, text: "ACME Corp contract version two" });
      const rewritten = expectDefined(await getTextRow(pdfAssetId));
      expect(rewritten.status).toBe("present");
      const grepAfterRewrite = await client.assets.grep({
        pattern: "version two",
        scope: { assetIds: [pdfAssetId] },
      });
      expect(grepAfterRewrite.matches).toHaveLength(1);
    });

    it("auto-re-registers a text-kind asset on repoint (never stale, greppable with the new content)", async () => {
      const drive = await client.drives.create({
        autoMerge: true,
        slug: "text-repoint-drive",
        name: "Text Repoint Drive",
        files: [{ path: "notes.md", content: "revision one mentions FOOMARKER" }],
      });
      if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");
      const mountedAssetId = expectDefined(drive.files.find((f) => f.path === "notes.md")).assetId;

      const beforeGrep = await client.assets.grep({
        pattern: "FOOMARKER",
        scope: { assetIds: [mountedAssetId] },
      });
      expect(beforeGrep.matches).toHaveLength(1);

      const cr = await client.drives.createChangeRequest({
        nodeId: drive.node.id,
        operations: [
          { kind: "update", path: "notes.md", content: "revision two mentions BARMARKER" },
        ],
        message: "Rewrite notes",
        submittedBy: "agent",
      });
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: cr.id });

      const row = expectDefined(await getTextRow(mountedAssetId));
      expect(row.status).toBe("present"); // never stale for a pure text-kind row
      expect(row.writtenBy).toBe("auto");

      const oldGrep = await client.assets.grep({
        pattern: "FOOMARKER",
        scope: { assetIds: [mountedAssetId] },
      });
      expect(oldGrep.matches).toHaveLength(0);

      const newGrep = await client.assets.grep({
        pattern: "BARMARKER",
        scope: { assetIds: [mountedAssetId] },
      });
      expect(newGrep.matches).toHaveLength(1);
    });

    it("deletes a text-kind asset's auto row when repointed to binary bytes (reverts to missing, not stuck stale)", async () => {
      // Regression: repointing a text-kind auto row to now-binary bytes used
      // to set `status: "stale"` — but the grep engine's lazy self-heal only
      // ever registers assets with NO row at all, so a `stale` auto row was
      // never revisited and stayed stuck mislabeled forever (never `missing`,
      // never retried, even though a writer supplying real text via `putText`
      // afterward would work fine — self-heal just never got the chance to
      // notice anything needed retrying).
      const drive = await client.drives.create({
        autoMerge: true,
        slug: "text-to-binary-repoint-drive",
        name: "Text To Binary Repoint Drive",
        files: [{ path: "notes.md", content: "revision one mentions FOOMARKER" }],
      });
      if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");
      const mountedAssetId = expectDefined(drive.files.find((f) => f.path === "notes.md")).assetId;

      // A content-created text file gets its `busabase_asset_texts` row via
      // lazy self-heal (same as the "auto-re-registers" test above) — trigger
      // it with a grep before asserting on the row.
      const selfHealGrep = await client.assets.grep({
        pattern: "FOOMARKER",
        scope: { assetIds: [mountedAssetId] },
      });
      expect(selfHealGrep.matches).toHaveLength(1);

      const beforeRow = expectDefined(await getTextRow(mountedAssetId));
      expect(beforeRow.status).toBe("present");
      expect(beforeRow.writtenBy).toBe("auto");

      const { assetId: binaryAssetId } = await uploadAsset({
        fileName: "photo.png",
        mimeType: "image/png",
        // A fresh, never-reused hash byte — this asset's binariness must not
        // get muddied by attachment-level content-hash dedup against an
        // earlier text-mimeType upload in this file (dedup keeps the FIRST
        // registration's stored attachment mimeType, and a CR operation that
        // omits its own `mimeType` falls back to that attachment's mimeType —
        // an unrelated collision here would silently turn this into a
        // text-kind repoint instead of the binary one this test means to
        // exercise). `mimeType` is also set explicitly on the CR operation
        // below as a second, independent safeguard.
        hashByte: "f",
      });

      const cr = await client.drives.createChangeRequest({
        nodeId: drive.node.id,
        operations: [
          { kind: "update", path: "notes.md", assetId: binaryAssetId, mimeType: "image/png" },
        ],
        message: "Replace notes with a binary file",
        submittedBy: "agent",
      });
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: cr.id });

      // Reverted to "missing" (no row) — NOT stuck as `stale` forever.
      expect(await getTextRow(mountedAssetId)).toBeUndefined();

      const grep = await client.assets.grep({
        pattern: "anything",
        scope: { assetIds: [mountedAssetId] },
      });
      expect(grep.missing).toContain(mountedAssetId);
      expect(grep.stale).not.toContain(mountedAssetId);
    });
  });
});
