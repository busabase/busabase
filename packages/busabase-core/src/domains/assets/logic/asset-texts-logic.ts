import "server-only";

/**
 * Drive Grep Retrieval — text-slot writes (`putText`), auto-registration,
 * lazy self-heal, staleness on repoint, and reference-counted GC.
 * See apps/busabase/content/spec/drive-grep-retrieval.md for the full design.
 *
 * Busabase stores, indexes, and searches text; it never generates it. Text
 * always arrives either automatically (text-kind files point at their own
 * bytes — no writer needed) or via `putText`, called by an external writer
 * (an agent's own extractor, or a future Outgoing-Hook-triggered service).
 * No extraction library — PDF/OCR/docx — lives here or anywhere in busabase-core.
 */
import { ORPCError } from "@orpc/server";
import type {
  AssetTextStatus as AssetTextStatusVO,
  AssetTextVO,
  CreateTextUploadUrlInput,
  CreateTextUploadUrlVO,
  PutTextInput,
} from "busabase-contract/domains/assets/types";
import { and, eq, ne } from "drizzle-orm";
import { generateNanoID } from "openlib/nanoid";
import { storage } from "openlib/storage";
import { getContextSpaceId, resolveActorId } from "../../../context";
import { getDb } from "../../../db";
import { attachments, busabaseAssets } from "../../../db/schema";
import { insertAuditEvent } from "../../../logic/audit";
import { id } from "../../../logic/kernel";
import { ensureReady } from "../../../logic/seed";
import { type AssetTextPO, type AssetTextStatus, busabaseAssetTexts } from "../schema/asset-texts";
import { readObjectInChunks } from "./object-stream";
import { scanTextBuffer, TextStreamScanner } from "./text-scan";

type Db = Awaited<ReturnType<typeof getDb>>;

/** ≤ 1 MB inline body cap — larger text must go through the presigned path. */
export const INLINE_TEXT_MAX_BYTES = 1024 * 1024;

/** Content-addressed text blobs mirror the attachments convention exactly. */
export const TEXT_BLOB_PREFIX = "asset-texts/blobs/sha256";
/** Temporary landing key for a presigned text upload, bound (and moved) by `putText`. */
export const TEXT_TEMP_PREFIX = "asset-texts/pending";
const TEXT_UPLOAD_EXPIRES_IN = 3600;

/**
 * `asset-texts/blobs/sha256/{2ch}/{hash}.txt` — Git/OCI-style content
 * addressing, same shape as `contentAddressedKey` in
 * `open-domains/attachments/logic/upload-logic.ts`.
 */
export const textContentAddressedKey = (sha256Hash: string): string => {
  const hex = sha256Hash.replace(/^sha256:/, "");
  const shard = hex.slice(0, 2);
  return `${TEXT_BLOB_PREFIX}/${shard}/${hex}.txt`;
};

/** Derive the AssetVO-facing `textStatus` from a (possibly absent) joined text row status. */
export const deriveAssetTextStatus = (
  status: AssetTextStatus | null | undefined,
): AssetTextStatusVO => status ?? "missing";

/**
 * Look up one asset's `textStatus` directly (for call sites that build an
 * `AssetVO` without already having joined `busabase_asset_texts` — e.g.
 * `domains/file-node/handlers.ts`, which resolves a File node's asset via
 * `resolveAssetFile`, a hot path that intentionally skips this join).
 */
export const getAssetTextStatus = async (assetId: string, tx?: Db): Promise<AssetTextStatusVO> => {
  const db = tx ?? (await getDb());
  const [row] = await db
    .select({ status: busabaseAssetTexts.status })
    .from(busabaseAssetTexts)
    .where(eq(busabaseAssetTexts.assetId, assetId))
    .limit(1);
  return deriveAssetTextStatus(row?.status);
};

/**
 * Reference-counted GC: a text object is only deleted once no *derived*
 * `busabase_asset_texts` row anywhere still points at that hash (mirrors
 * `deleteAttachmentSafely`). Global by hash (not space-scoped) — identical
 * text supplied in two spaces still shares one object.
 *
 * Excludes `writtenBy: "auto"` rows from the refcount query on purpose: an
 * auto row's `textContentHash` describes its OWNING ATTACHMENT's bytes (it
 * never copies anything into `asset-texts/blobs/...` — it just points at the
 * attachment's own object), so it never actually "references" a derived-text
 * blob even when the hash happens to match one byte-for-byte. Without this
 * filter, an auto row could make the query think a derived blob is "still
 * referenced" and skip deleting it — the opposite failure from the leak this
 * function exists to prevent. Exported so callers that just cascaded away a
 * `busabase_asset_texts` row (e.g. `deleteAssetRow`) can trigger the same GC
 * check for the row they just removed.
 */
export const gcTextObjectIfUnreferenced = async (
  hash: string | null | undefined,
  excludeRowId: string | null,
  tx: Db,
): Promise<void> => {
  if (!hash) return;
  const rows = await tx
    .select({ id: busabaseAssetTexts.id })
    .from(busabaseAssetTexts)
    .where(
      and(eq(busabaseAssetTexts.textContentHash, hash), ne(busabaseAssetTexts.writtenBy, "auto")),
    );
  const stillReferenced = rows.some((row) => row.id !== excludeRowId);
  if (!stillReferenced) {
    await storage.deleteObject(textContentAddressedKey(hash)).catch(() => {});
  }
};

/**
 * Auto-register a text-kind asset's row (0 bytes copied, 0 bytes scanned —
 * points at the asset's own attachment object). Idempotent / no-op if a row
 * already exists (auto OR derived — never overwrite a writer's text) or the
 * asset isn't text-kind. Called from `confirmAssetUpload` (immediately, so
 * every text-kind upload is greppable right away) AND from the grep engine's
 * candidate listing (lazy self-heal — makes pre-existing assets from before
 * this feature shipped greppable on first use, no backfill job needed).
 *
 * `opts.knownContentKind` / `opts.knownMissing` let a caller that already
 * knows the answer (both current call sites do — `confirmAssetUpload` just
 * computed the kind from the upload's mimeType and minted a brand-new
 * assetId; the grep self-heal loop already filtered to `contentKind ===
 * "text"` candidates with no existing row) skip the corresponding query
 * entirely, so a binary upload (the common case) pays ZERO extra queries for
 * this best-effort side effect, not just an isolated-but-still-paid one.
 */
export const autoRegisterAssetText = async (
  assetId: string,
  tx?: Db,
  opts?: { knownContentKind?: string; knownMissing?: boolean },
): Promise<void> => {
  const db = tx ?? (await getDb());

  if (opts?.knownContentKind !== undefined) {
    if (opts.knownContentKind !== "text") return;
  } else {
    const [assetRow] = await db
      .select({ contentKind: busabaseAssets.contentKind })
      .from(busabaseAssets)
      .where(eq(busabaseAssets.id, assetId))
      .limit(1);
    if (!assetRow || assetRow.contentKind !== "text") return;
  }

  if (!opts?.knownMissing) {
    const [existing] = await db
      .select({ id: busabaseAssetTexts.id })
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.assetId, assetId))
      .limit(1);
    if (existing) return;
  }

  const [assetRow] = await db
    .select({
      spaceId: busabaseAssets.spaceId,
      storageKey: attachments.storageKey,
      contentHash: attachments.contentHash,
    })
    .from(busabaseAssets)
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(eq(busabaseAssets.id, assetId))
    .limit(1);
  if (!assetRow) return;

  await db
    .insert(busabaseAssetTexts)
    .values({
      id: id("atx"),
      spaceId: assetRow.spaceId,
      assetId,
      status: "present",
      textStorageKey: assetRow.storageKey,
      textContentHash: assetRow.contentHash ?? null,
      sourceContentHash: null,
      writtenBy: "auto",
      lineCount: 0,
      charCount: 0,
      byteCount: 0,
      lineCheckpoints: [],
      // Never scanned — sentinel 0/0/0 stats above. `readLines` computes and
      // persists the real stats lazily on first use (see
      // `computeAndPersistCheckpoints` in `asset-grep-logic.ts`).
      statsComputedAt: null,
    })
    .onConflictDoNothing();
};

/**
 * Hook for the asset `attachmentId` repoint call site (file-tree replace —
 * `upsertFileAssetAtPath` in `domains/filetree/handlers.ts`). No-op if the
 * asset has no text row yet (self-heal will register it fresh against the
 * NEW bytes on first grep, which is already correct — nothing to invalidate).
 *
 * - `writtenBy === "auto"` (pure text-kind row): re-registers against the new
 *   attachment instead of going stale — text-kind files always mirror their
 *   own current bytes, so `status` stays `present` forever.
 * - Anything else (derived text from a writer): compares `sourceContentHash`
 *   against the new attachment's hash; a real change flips `status` to
 *   `stale` (excluded from grep, reported honestly) rather than silently
 *   serving text derived from the old version.
 */
export const handleAssetAttachmentRepoint = async (
  assetId: string,
  newAttachmentId: string,
  tx: Db,
): Promise<void> => {
  const [existing] = await tx
    .select()
    .from(busabaseAssetTexts)
    .where(eq(busabaseAssetTexts.assetId, assetId))
    .limit(1);
  if (!existing) return;

  const [newAttachment] = await tx
    .select({ storageKey: attachments.storageKey, contentHash: attachments.contentHash })
    .from(attachments)
    .where(eq(attachments.id, newAttachmentId))
    .limit(1);
  if (!newAttachment) return;

  if (existing.writtenBy === "auto") {
    const [assetRow] = await tx
      .select({ contentKind: busabaseAssets.contentKind })
      .from(busabaseAssets)
      .where(eq(busabaseAssets.id, assetId))
      .limit(1);
    if (assetRow?.contentKind === "text") {
      await tx
        .update(busabaseAssetTexts)
        .set({
          textStorageKey: newAttachment.storageKey,
          textContentHash: newAttachment.contentHash ?? null,
          sourceContentHash: null,
          status: "present",
          lineCount: 0,
          charCount: 0,
          byteCount: 0,
          lineCheckpoints: [],
          // Re-pointed at new bytes — any previously computed stats/checkpoints
          // no longer apply; `readLines` must (lazily) rescan before trusting them.
          statsComputedAt: null,
        })
        .where(eq(busabaseAssetTexts.id, existing.id));
      // No GC call here: an auto row never owns a separate `asset-texts/blobs/...`
      // object (its `textContentHash` just described its OWNING ATTACHMENT's
      // bytes) — there is nothing to garbage-collect for it.
    } else {
      // The asset flipped from text-kind to binary at this path — the auto
      // row no longer describes valid text for it, and (being an auto row) it
      // never owned a separate blob to GC either. Delete it outright rather
      // than marking it `stale`: the grep engine's lazy self-heal only ever
      // registers assets with NO row at all (`!textRows.has(...)`), so a
      // `stale` auto row would never be revisited and would stay stuck
      // mislabeled forever. Deleting it reverts the asset to a true "missing"
      // state — self-heal (or a future `putText`) can register it fresh.
      await tx.delete(busabaseAssetTexts).where(eq(busabaseAssetTexts.id, existing.id));
    }
    return;
  }

  const unchanged =
    existing.sourceContentHash != null && existing.sourceContentHash === newAttachment.contentHash;
  if (!unchanged) {
    await tx
      .update(busabaseAssetTexts)
      .set({ status: "stale" })
      .where(eq(busabaseAssetTexts.id, existing.id));
  }
};

interface UpsertFields {
  status: AssetTextStatus;
  textStorageKey: string;
  textContentHash: string | null;
  sourceContentHash: string | null;
  writtenBy: string;
  lineCount: number;
  charCount: number;
  byteCount: number;
  lineCheckpoints: { line: number; byteOffset: number }[];
  statsComputedAt: Date | null;
}

const upsertAssetTextRow = async (
  db: Db,
  spaceId: string,
  assetId: string,
  existing: AssetTextPO | undefined,
  fields: UpsertFields,
): Promise<string> => {
  if (existing) {
    await db.update(busabaseAssetTexts).set(fields).where(eq(busabaseAssetTexts.id, existing.id));
    return existing.id;
  }
  const rowId = id("atx");
  await db.insert(busabaseAssetTexts).values({ id: rowId, spaceId, assetId, ...fields });
  return rowId;
};

const emptyTextFields = (writtenBy: string): UpsertFields => ({
  status: "none",
  textStorageKey: "",
  textContentHash: null,
  sourceContentHash: null,
  writtenBy,
  lineCount: 0,
  charCount: 0,
  byteCount: 0,
  lineCheckpoints: [],
  statsComputedAt: null,
});

/**
 * Write (or mark none) an asset's text slot. Exactly one of `text` (inline,
 * ≤1MB) | `storageKey` (presigned bind) | `none` must be set. One streaming
 * pass over the bytes computes the content hash, validates UTF-8, and builds
 * adaptive line checkpoints; the presigned path never buffers the whole
 * object (`readObjectInChunks`, bounded windows via `getObjectRange`).
 *
 * Overrides an existing auto-registered row (an agent supplying real
 * extracted text for a binary asset, or a UTF-8 transcode of a non-UTF-8
 * auto-registered text file) — `writtenBy` always becomes the calling actor,
 * flipping the row to derived-text semantics (subject to staleness tracking)
 * from then on. Direct write, audit-logged, NOT ChangeRequest-gated.
 */
export const putAssetText = async (input: PutTextInput): Promise<AssetTextVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const modeCount = [
    input.text !== undefined,
    input.storageKey !== undefined,
    input.none === true,
  ].filter(Boolean).length;
  if (modeCount !== 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: "putText requires exactly one of: text, storageKey, or none.",
    });
  }

  const [assetRow] = await db
    .select({
      id: busabaseAssets.id,
      attachmentContentHash: attachments.contentHash,
    })
    .from(busabaseAssets)
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(and(eq(busabaseAssets.id, input.assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!assetRow) {
    throw new ORPCError("NOT_FOUND", { message: `Asset not found: ${input.assetId}` });
  }

  const [existing] = await db
    .select()
    .from(busabaseAssetTexts)
    .where(eq(busabaseAssetTexts.assetId, input.assetId))
    .limit(1);

  const actorId = resolveActorId("agent");

  if (input.none) {
    const rowId = await upsertAssetTextRow(
      db,
      spaceId,
      input.assetId,
      existing,
      emptyTextFields(actorId),
    );
    await gcTextObjectIfUnreferenced(existing?.textContentHash, rowId, db);
    await insertAuditEvent(db, {
      action: "asset.text_marked_none",
      actorId,
      metadata: { assetId: input.assetId },
    });
    return { assetId: input.assetId, textStatus: "none", lineCount: 0, charCount: 0, byteCount: 0 };
  }

  let scanResult: ReturnType<typeof scanTextBuffer>;
  let inlineBytes: Buffer | null = null;

  if (input.text !== undefined) {
    inlineBytes = Buffer.from(input.text, "utf8");
    if (inlineBytes.byteLength > INLINE_TEXT_MAX_BYTES) {
      throw new ORPCError("PAYLOAD_TOO_LARGE", {
        message: `Inline text exceeds the ${INLINE_TEXT_MAX_BYTES / (1024 * 1024)}MB limit (${inlineBytes.byteLength} bytes). Use createTextUploadUrl + putText({ storageKey }) for larger text.`,
      });
    }
    scanResult = scanTextBuffer(inlineBytes);
  } else {
    const storageKey = input.storageKey as string;
    if (!storageKey.startsWith(`${TEXT_TEMP_PREFIX}/`)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `storageKey must be a pending text upload under ${TEXT_TEMP_PREFIX}/ (from createTextUploadUrl).`,
      });
    }
    const scanner = new TextStreamScanner();
    try {
      for await (const chunk of readObjectInChunks(storageKey)) {
        scanner.write(chunk);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ORPCError("BAD_REQUEST", {
        message: `Failed to read the pending text upload at ${storageKey}: ${message}`,
      });
    }
    scanResult = scanner.finish();
  }

  const cleanupTemp = async () => {
    if (input.storageKey) {
      await storage.deleteObject(input.storageKey).catch(() => {});
    }
  };

  if (!scanResult.valid) {
    await cleanupTemp();
    throw new ORPCError("BAD_REQUEST", {
      message: "Text is not valid UTF-8. Busabase text objects are UTF-8 by contract.",
    });
  }
  if (input.contentHash && input.contentHash !== scanResult.sha256) {
    await cleanupTemp();
    throw new ORPCError("BAD_REQUEST", {
      message: "Claimed contentHash does not match the actual bytes.",
    });
  }

  const finalKey = textContentAddressedKey(scanResult.sha256);
  const alreadyStored = await storage.objectExists(finalKey).catch(() => false);
  if (input.text !== undefined) {
    if (!alreadyStored && inlineBytes) {
      await storage.uploadFileToKey(inlineBytes, finalKey, "text/plain; charset=utf-8");
    }
  } else {
    const storageKey = input.storageKey as string;
    if (!alreadyStored) {
      await storage.copyObject(storageKey, finalKey);
    }
    await storage.deleteObject(storageKey).catch(() => {});
  }

  const rowId = await upsertAssetTextRow(db, spaceId, input.assetId, existing, {
    status: "present",
    textStorageKey: finalKey,
    textContentHash: scanResult.sha256,
    sourceContentHash: assetRow.attachmentContentHash ?? null,
    writtenBy: actorId,
    lineCount: scanResult.lineCount,
    charCount: scanResult.charCount,
    byteCount: scanResult.byteCount,
    lineCheckpoints: scanResult.checkpoints,
    // Derived rows always compute real stats eagerly, right here — never the
    // 0/0/0 "unscanned" sentinel an auto row starts with.
    statsComputedAt: new Date(),
  });
  if (existing?.textContentHash && existing.textContentHash !== scanResult.sha256) {
    await gcTextObjectIfUnreferenced(existing.textContentHash, rowId, db);
  }

  await insertAuditEvent(db, {
    action: "asset.text_written",
    actorId,
    metadata: {
      assetId: input.assetId,
      lineCount: scanResult.lineCount,
      charCount: scanResult.charCount,
      byteCount: scanResult.byteCount,
    },
  });

  return {
    assetId: input.assetId,
    textStatus: "present",
    lineCount: scanResult.lineCount,
    charCount: scanResult.charCount,
    byteCount: scanResult.byteCount,
  };
};

/** Presigned URL for a large text write — bytes PUT here, then bound via `putText({ storageKey })`. */
export const createAssetTextUploadUrl = async (
  input: CreateTextUploadUrlInput,
): Promise<CreateTextUploadUrlVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const [assetRow] = await db
    .select({ id: busabaseAssets.id })
    .from(busabaseAssets)
    .where(and(eq(busabaseAssets.id, input.assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!assetRow) {
    throw new ORPCError("NOT_FOUND", { message: `Asset not found: ${input.assetId}` });
  }

  const storageKey = `${TEXT_TEMP_PREFIX}/${generateNanoID()}.txt`;
  const uploadUrl = await storage.generateUploadPresignedUrl(
    storageKey,
    "text/plain; charset=utf-8",
    TEXT_UPLOAD_EXPIRES_IN,
  );
  return { uploadUrl, storageKey, expiresIn: TEXT_UPLOAD_EXPIRES_IN };
};
