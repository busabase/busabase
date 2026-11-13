import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ORPCError } from "@orpc/server";
import { DumpTableSchema } from "busabase-contract/domains/dump/types";
import { getLocalStoragePath, isLocalStorageProvider, storage } from "openlib/storage";
import { z } from "zod";
import type { BusabaseDatabase } from "../../../context";
import { withStorageKeyLocks } from "../../assets/logic/storage-cleanup-logic";
import {
  type CompletedImportControl,
  completedImportControlKey,
  readCompletedImportControl,
  writeCompletedImportControl,
} from "./import-replay-control";

const ActivitySchema = z.object({
  version: z.literal(1),
  spaceId: z.string().min(1),
  sessionId: z.string().min(1),
  sourceSpaceId: z.string().min(1),
  startedAt: z.string().datetime(),
  /** Missing on older markers means unknown, never permission to overwrite a root. */
  rootImported: z.boolean().optional(),
  sourceArchiveChecksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  preserveViewMetadata: z.boolean().optional(),
  expectedTables: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
type Activity = z.infer<typeof ActivitySchema>;
interface RestoreIdentityInput {
  spaceId: string;
  sourceSpaceId: string;
  resume: boolean;
  sourceArchiveChecksum?: string;
  preserveViewMetadata?: boolean;
  expectedTables?: Record<string, number>;
}

const assertArchiveIdentity = async (input: RestoreIdentityInput, previous: Activity | null) => {
  if (previous && !input.resume)
    throw new ORPCError("CONFLICT", {
      message: "This space has an unfinished restore; resume the same verified archive.",
    });
  if (!input.resume || !input.sourceArchiveChecksum) return;
  const identity = previous ?? (await readCompletedImportControl(input.spaceId));
  if (
    !identity ||
    identity.sourceSpaceId !== input.sourceSpaceId ||
    identity.sourceArchiveChecksum !== input.sourceArchiveChecksum ||
    identity.preserveViewMetadata !== input.preserveViewMetadata ||
    !identity.expectedTables ||
    !input.expectedTables ||
    DumpTableSchema.options.some(
      (table) => (identity.expectedTables?.[table] ?? 0) !== (input.expectedTables?.[table] ?? 0),
    )
  )
    throw new ORPCError("CONFLICT", {
      message:
        "Cannot resume a different or unverified archive. Use the same verified archive or a fresh empty target.",
    });
};

/** A host-control object, not user data. The blob GC only handles receipt.json. */
export const restoreActivityKey = (spaceId: string) =>
  `busabase/dump-staging-v1/${createHash("sha256").update(spaceId).digest("hex")}/activity.json`;

const isMissingObject = (error: unknown, key: string): boolean => {
  if (!error || typeof error !== "object") return false;
  const detail = error as { code?: unknown; name?: unknown; message?: unknown };
  return (
    detail.code === "ENOENT" ||
    detail.name === "NoSuchKey" ||
    detail.name === "NotFound" ||
    detail.message === `Object not found: ${key}`
  );
};
async function readActivity(spaceId: string): Promise<Activity | null> {
  const key = restoreActivityKey(spaceId);
  let bytes: Buffer;
  try {
    bytes = await storage.getObject(key);
  } catch (error) {
    if (isMissingObject(error, key)) return null;
    // Only the provider's explicit auto_create=true policy may initialize a
    // fresh store. listObjects enforces that policy; false/403 still throw.
    if (error && typeof error === "object" && "name" in error && error.name === "NoSuchBucket") {
      await storage.listObjects(key, 1);
      try {
        bytes = await storage.getObject(key);
      } catch (retryError) {
        if (isMissingObject(retryError, key)) return null;
        throw retryError;
      }
    } else throw error;
  }
  if (bytes.length > 16 * 1024)
    throw new Error("Restore activity marker exceeds its metadata limit");
  const activity = ActivitySchema.parse(JSON.parse(bytes.toString("utf8")));
  if (activity.spaceId !== spaceId)
    throw new Error("Restore activity marker belongs to a different space");
  return activity;
}
async function writeActivity(activity: Activity): Promise<void> {
  const key = restoreActivityKey(activity.spaceId),
    bytes = Buffer.from(JSON.stringify(activity));
  if (!isLocalStorageProvider()) {
    await storage.uploadFileToKey(bytes, key, "application/json");
    return;
  }
  const destination = getLocalStoragePath(key);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/** Local rename publication can leave a pre-crash sibling; never touch another namespace. */
async function cleanupActivityTemporaries(spaceId: string): Promise<void> {
  if (!isLocalStorageProvider()) return;
  const destination = getLocalStoragePath(restoreActivityKey(spaceId));
  let files: string[];
  try {
    files = await readdir(path.dirname(destination));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of files)
    if (/^activity\.json\.[a-f0-9]{16}\.tmp$/.test(name))
      await unlink(path.join(path.dirname(destination), name));
}

/**
 * Publish before any imported row/object. A crash or session TTL never removes
 * the marker: a half-restored workflow is unsafe regardless of how old it is.
 */
export const beginRestoreActivity = async (
  db: BusabaseDatabase,
  input: {
    spaceId: string;
    sessionId: string;
    sourceSpaceId: string;
    resume: boolean;
    sourceArchiveChecksum?: string;
    preserveViewMetadata?: boolean;
    expectedTables?: Record<string, number>;
  },
): Promise<{ canInitializeRoot: boolean }> =>
  withStorageKeyLocks(
    db,
    [restoreActivityKey(input.spaceId), completedImportControlKey(input.spaceId)],
    async () => {
      const previous = await readActivity(input.spaceId);
      await assertArchiveIdentity(input, previous);
      if (previous && previous.sessionId !== input.sessionId) {
        if (!input.resume || previous.sourceSpaceId !== input.sourceSpaceId)
          throw new ORPCError("CONFLICT", {
            message:
              "This space has an unfinished restore. Resume the same source archive before allowing automation.",
          });
      }
      await writeActivity({
        version: 1,
        spaceId: input.spaceId,
        sessionId: input.sessionId,
        sourceSpaceId: input.sourceSpaceId,
        startedAt: new Date().toISOString(),
        rootImported: previous ? previous.rootImported : input.resume ? undefined : false,
        sourceArchiveChecksum: input.sourceArchiveChecksum,
        preserveViewMetadata: input.preserveViewMetadata,
        expectedTables: input.expectedTables,
      });
      await cleanupActivityTemporaries(input.spaceId);
      return {
        canInitializeRoot:
          input.resume &&
          !!previous &&
          previous.sourceSpaceId === input.sourceSpaceId &&
          !!input.sourceArchiveChecksum &&
          previous.sourceArchiveChecksum === input.sourceArchiveChecksum &&
          previous.rootImported === false,
      };
    },
  );

/** Check identity before cleanup, table scans, or publishing a replacement activity owner. */
export const assertRestoreArchiveIdentity = async (
  db: BusabaseDatabase,
  input: RestoreIdentityInput,
): Promise<void> =>
  withStorageKeyLocks(
    db,
    [restoreActivityKey(input.spaceId), completedImportControlKey(input.spaceId)],
    async () => {
      await assertArchiveIdentity(input, await readActivity(input.spaceId));
    },
  );

/** Publish before the first root replacement; uncertain crash windows fail closed. */
export const markRestoreRootImported = async (
  db: BusabaseDatabase,
  input: { spaceId: string; sessionId: string },
): Promise<void> =>
  withStorageKeyLocks(db, [restoreActivityKey(input.spaceId)], async () => {
    const activity = await readActivity(input.spaceId);
    if (!activity || activity.sessionId !== input.sessionId)
      throw new ORPCError("CONFLICT", { message: "A different restore owns this space" });
    if (activity.rootImported !== true) await writeActivity({ ...activity, rootImported: true });
  });

/** A resumed session fences any older worker before it can import another batch. */
export const assertRestoreActivity = async (spaceId: string, sessionId: string): Promise<void> => {
  const activity = await readActivity(spaceId);
  if (!activity || activity.sessionId !== sessionId)
    throw new ORPCError("CONFLICT", {
      message:
        "This restore no longer owns the space's activity marker. Resume the same archive in a new session.",
    });
};

/** Call only after a complete commit or a complete non-resume rollback. */
export const endRestoreActivity = async (
  db: BusabaseDatabase,
  input: {
    spaceId: string;
    sessionId: string;
    completed?: Pick<
      CompletedImportControl,
      "sourceArchiveChecksum" | "preserveViewMetadata" | "expectedTables"
    >;
  },
): Promise<void> =>
  withStorageKeyLocks(
    db,
    [restoreActivityKey(input.spaceId), completedImportControlKey(input.spaceId)],
    async () => {
      const activity = await readActivity(input.spaceId);
      if (!activity) {
        await cleanupActivityTemporaries(input.spaceId);
        return;
      }
      if (activity.sessionId !== input.sessionId)
        throw new ORPCError("CONFLICT", {
          message: "A different restore owns this space; its automation hold was preserved.",
        });
      if (input.completed) {
        if ((activity.sourceArchiveChecksum ?? null) !== input.completed.sourceArchiveChecksum)
          throw new ORPCError("CONFLICT", {
            message: "Completed archive identity differs from the active restore",
          });
        // Publish completion durably before releasing the automation barrier.
        await writeCompletedImportControl({
          version: 1,
          spaceId: input.spaceId,
          sourceSpaceId: activity.sourceSpaceId,
          completedAt: new Date().toISOString(),
          ...input.completed,
        });
      }
      await cleanupActivityTemporaries(input.spaceId);
      await storage.deleteObject(restoreActivityKey(input.spaceId));
    },
  );

/** No process cache: every worker/replica sees the durable hold. Errors block work. */
export const isRestoreAutomationBlocked = async (spaceId: string): Promise<boolean> => {
  try {
    return (await readActivity(spaceId)) !== null;
  } catch (error) {
    console.error(
      "[busabase] automation held because restore activity could not be read",
      spaceId,
      error,
    );
    return true;
  }
};

/** A held space must not fill a scheduler's LIMIT and starve unrelated spaces. */
export const selectOutsideRestoringSpaces = async <T extends { spaceId: string }>(
  select: (excludedSpaceIds: string[]) => Promise<T[]>,
): Promise<T[]> => {
  const blocked = new Set<string>(),
    checked = new Map<string, boolean>();
  for (;;) {
    const rows = await select([...blocked]);
    let foundBlocked = false;
    for (const row of rows) {
      if (blocked.has(row.spaceId))
        throw new Error("Automation candidate query did not exclude a held space");
      if (!checked.has(row.spaceId))
        checked.set(row.spaceId, await isRestoreAutomationBlocked(row.spaceId));
      if (checked.get(row.spaceId)) {
        blocked.add(row.spaceId);
        foundBlocked = true;
      }
    }
    if (!foundBlocked) return rows;
  }
};
