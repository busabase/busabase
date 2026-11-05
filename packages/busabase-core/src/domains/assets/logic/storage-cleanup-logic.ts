import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq, inArray, lte } from "drizzle-orm";
import { ATTACHMENT_UPLOAD_EXPIRES_IN_SECONDS } from "open-domains/attachments/logic";
import { attachments } from "open-domains/attachments/schema";
import { storage } from "openlib/storage";
import type { BusabaseDatabase } from "../../../context";
import { busabaseAssetTexts } from "../schema/asset-texts";
import {
  busabaseStorageCleanupJobs,
  type StorageCleanupKind,
} from "../schema/storage-cleanup-jobs";

type Db = BusabaseDatabase;

/** Acquire keys in lexical order when registering/retiring more than one. */
const lockStorageKey = async (db: Db, storageKey: string) => {
  await db.insert(busabaseStorageCleanupJobs).values({ storageKey }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(busabaseStorageCleanupJobs)
    .where(eq(busabaseStorageCleanupJobs.storageKey, storageKey))
    .for("update");
  if (!row) throw new Error("Storage key fence was not created");
  return row;
};

/** Serialize pointer changes/retirements using the same order as registration. */
export const withStorageKeyLocks = async <T>(
  db: Db,
  storageKeys: string[],
  change: (tx: Db) => Promise<T>,
): Promise<T> =>
  db.transaction(async (tx) => {
    for (const key of [...new Set(storageKeys)].sort()) await lockStorageKey(tx, key);
    return change(tx);
  });

/**
 * Registration and retirement share the same transaction lock. Merely checking
 * a key before inserting an attachment is insufficient: the collector could
 * delete it between that check and the insert. Callers must mint a fresh key
 * when this rejects; retired keys are never resurrected.
 */
export const withStorageKeyRegistration = async <T>(
  db: Db,
  storageKey: string,
  register: (tx: Db) => Promise<T>,
  options: { additionalLockKeys?: string[] } = {},
): Promise<T> =>
  db.transaction(async (tx) => {
    let row: Awaited<ReturnType<typeof lockStorageKey>> | undefined;
    for (const key of [...new Set([storageKey, ...(options.additionalLockKeys ?? [])])].sort()) {
      const locked = await lockStorageKey(tx, key);
      if (key === storageKey) row = locked;
    }
    if (!row) throw new Error("Storage registration key was not locked");
    if (row.state !== "retained") {
      throw new ORPCError("CONFLICT", {
        message: "This file upload has expired. Start a new upload before confirming it.",
      });
    }
    return register(tx);
  });

export const isStorageKeyRetired = async (db: Db, storageKey: string): Promise<boolean> => {
  const [row] = await db
    .select({ state: busabaseStorageCleanupJobs.state })
    .from(busabaseStorageCleanupJobs)
    .where(eq(busabaseStorageCleanupJobs.storageKey, storageKey));
  return row !== undefined && row.state !== "retained";
};

/** Enqueue inside the same transaction that removes the last retained owner. */
export const enqueueStorageCleanup = async (
  db: Db,
  input: { storageKey: string; sizeBytes?: number; kind: StorageCleanupKind; spaceId: string },
): Promise<void> => {
  await db.transaction(async (tx) => {
    const row = await lockStorageKey(tx, input.storageKey);
    if (row.state === "completed" || row.state === "processing") return;
    const now = new Date();
    await tx
      .update(busabaseStorageCleanupJobs)
      .set({
        spaceId: input.spaceId,
        kind: input.kind,
        sizeBytes: input.sizeBytes ?? 0,
        state: "pending",
        nextAttemptAt: now,
        finalSweepAt:
          row.finalSweepAt ??
          (input.kind === "attachment"
            ? new Date(now.getTime() + (ATTACHMENT_UPLOAD_EXPIRES_IN_SECONDS + 300) * 1000)
            : null),
        updatedAt: now,
      })
      .where(eq(busabaseStorageCleanupJobs.storageKey, input.storageKey));
  });
};

export const objectIsStillReferenced = async (db: Db, storageKey: string): Promise<boolean> => {
  const [attachment] = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(eq(attachments.storageKey, storageKey))
    .limit(1);
  if (attachment) return true;
  const [text] = await db
    .select({ id: busabaseAssetTexts.id })
    .from(busabaseAssetTexts)
    .where(eq(busabaseAssetTexts.textStorageKey, storageKey))
    .limit(1);
  return text !== undefined;
};

const isMissingObject = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  if (candidate.name === "NoSuchBucket" || candidate.code === "NoSuchBucket") return false;
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.code === "ENOENT" ||
    candidate.$metadata?.httpStatusCode === 404
  );
};

/**
 * How long a worker owns a claimed job. Deletion runs outside any transaction,
 * so a worker that crashes or stalls mid-delete holds no lock; its claim simply
 * lapses and another worker retries the (idempotent) delete.
 */
const CLEANUP_CLAIM_LEASE_MS = 3 * 60 * 1000;

/**
 * Process exact keys, never bucket prefixes.
 *
 * The object delete is network I/O, so it never runs while a row lock is held:
 * registration and purge take this key's row lock with a blocking
 * `FOR UPDATE`, and one stalled delete would queue them (and their pooled
 * connections) behind it. Instead a short transaction claims the job by
 * committing `processing` with a lease in `nextAttemptAt`, the delete runs
 * unlocked, and a second short transaction records the outcome only if the
 * claim is still ours. Committed `processing` is a retired state, so the
 * registration fence keeps rejecting the key throughout.
 */
export const processStorageCleanupJobs = async (
  db: Db,
  options: { limit?: number; now?: Date } = {},
): Promise<{ processed: number; deleted: number; retained: number; failed: number }> => {
  const result = { processed: 0, deleted: 0, retained: 0, failed: 0 };
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? 25, 0), 100);
  for (let index = 0; index < limit; index += 1) {
    const claim = await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(busabaseStorageCleanupJobs)
        .where(
          and(
            // `processing` rows are due again only once their claim lease lapsed.
            inArray(busabaseStorageCleanupJobs.state, ["pending", "processing"]),
            lte(busabaseStorageCleanupJobs.nextAttemptAt, now),
          ),
        )
        .orderBy(busabaseStorageCleanupJobs.nextAttemptAt, busabaseStorageCleanupJobs.storageKey)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!job) return null;
      const predicate = eq(busabaseStorageCleanupJobs.storageKey, job.storageKey);
      if (await objectIsStillReferenced(tx, job.storageKey)) {
        await tx
          .update(busabaseStorageCleanupJobs)
          .set({
            state: "pending",
            nextAttemptAt: new Date(now.getTime() + 60 * 60 * 1000),
            lastError: "Object remains referenced; deletion deferred.",
            updatedAt: now,
          })
          .where(predicate);
        return { outcome: "retained" as const };
      }
      const attempts = job.attempts + 1;
      await tx
        .update(busabaseStorageCleanupJobs)
        .set({
          state: "processing",
          attempts,
          nextAttemptAt: new Date(now.getTime() + CLEANUP_CLAIM_LEASE_MS),
          updatedAt: now,
        })
        .where(predicate);
      return { outcome: "claimed" as const, job, attempts };
    });
    if (claim === null) break;
    result.processed += 1;
    if (claim.outcome === "retained") {
      result.retained += 1;
      continue;
    }

    const { job, attempts } = claim;
    let deleteError: unknown;
    try {
      await storage.deleteObject(job.storageKey);
    } catch (error) {
      if (!isMissingObject(error)) deleteError = error;
    }
    // Only the current claim may record an outcome; a worker whose lease lapsed
    // and was re-claimed must not overwrite the newer attempt.
    const stillClaimed = and(
      eq(busabaseStorageCleanupJobs.storageKey, job.storageKey),
      eq(busabaseStorageCleanupJobs.state, "processing"),
      eq(busabaseStorageCleanupJobs.attempts, attempts),
    );
    if (deleteError === undefined) {
      const awaitingFinalSweep = job.finalSweepAt !== null && now < job.finalSweepAt;
      await db
        .update(busabaseStorageCleanupJobs)
        .set({
          state: awaitingFinalSweep ? "pending" : "completed",
          completedAt: awaitingFinalSweep ? null : now,
          nextAttemptAt: awaitingFinalSweep ? (job.finalSweepAt ?? now) : now,
          lastError: null,
          updatedAt: now,
        })
        .where(stillClaimed);
      result.deleted += 1;
    } else {
      const delayMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.min(attempts - 1, 7));
      await db
        .update(busabaseStorageCleanupJobs)
        .set({
          state: "pending",
          nextAttemptAt: new Date(now.getTime() + delayMs),
          lastError: (deleteError instanceof Error
            ? deleteError.message
            : String(deleteError)
          ).slice(0, 2000),
          updatedAt: now,
        })
        .where(stillClaimed);
      result.failed += 1;
    }
  }
  return result;
};
