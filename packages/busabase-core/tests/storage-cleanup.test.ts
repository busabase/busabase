import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { LocalStorage, resetStorage, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BusabaseDatabase } from "../src/context";
import * as schema from "../src/db/schema";
import {
  enqueueStorageCleanup,
  isStorageKeyRetired,
  processStorageCleanupJobs,
  withStorageKeyLocks,
  withStorageKeyRegistration,
} from "../src/domains/assets/logic/storage-cleanup-logic";

describe("Storage cleanup outbox — real PGlite and local objects", () => {
  let client: PGlite;
  let db: BusabaseDatabase;
  let databaseRoot: string;
  let storageRoot: string;
  let previousStorageUrl: string | undefined;

  beforeAll(async () => {
    previousStorageUrl = process.env.STORAGE_URL;
    databaseRoot = await mkdtemp(path.join(os.tmpdir(), "busabase-cleanup-db-"));
    storageRoot = await mkdtemp(path.join(os.tmpdir(), "busabase-cleanup-storage-"));
    process.env.STORAGE_URL = `local://${storageRoot}?base_url=/uploads`;
    resetStorage();
    client = new PGlite(databaseRoot, { extensions: { pg_trgm } });
    const instance = drizzle({ client, schema });
    await migrate(instance, {
      migrationsFolder: path.resolve(__dirname, "../../../apps/busabase/src/db/migrations"),
    });
    db = instance;
  });

  afterAll(async () => {
    await client?.close();
    resetStorage();
    if (previousStorageUrl === undefined) delete process.env.STORAGE_URL;
    else process.env.STORAGE_URL = previousStorageUrl;
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    if (databaseRoot) await rm(databaseRoot, { recursive: true, force: true });
  });

  const getJob = async (key: string) => {
    const [row] = await db
      .select()
      .from(schema.busabaseStorageCleanupJobs)
      .where(eq(schema.busabaseStorageCleanupJobs.storageKey, key));
    if (!row) throw new Error("Expected a durable cleanup job");
    return row;
  };

  it("retires the key, collects a late PUT, and rejects resurrection after the final sweep", async () => {
    const storageKey = "cleanup/exclusive.txt";
    await withStorageKeyRegistration(db, storageKey, async (tx) => {
      await storage.uploadFileToKey(Buffer.from("exclusive"), storageKey, "text/plain");
      await tx.insert(schema.attachments).values({
        id: "cleanup-exclusive",
        storageKey,
        fileName: "exclusive.txt",
        mimeType: "text/plain",
        sizeBytes: 9,
        userId: "local",
      });
    });
    expect(await isStorageKeyRetired(db, storageKey)).toBe(false);
    await db.transaction(async (tx) => {
      await enqueueStorageCleanup(tx, { storageKey, kind: "attachment", spaceId: "local" });
      await tx.delete(schema.attachments).where(eq(schema.attachments.id, "cleanup-exclusive"));
    });
    expect(await storage.objectExists(storageKey)).toBe(true);
    const now = new Date(Date.now() + 1_000);
    expect(await processStorageCleanupJobs(db, { now })).toMatchObject({ deleted: 1, failed: 0 });
    expect(await storage.objectExists(storageKey)).toBe(false);
    const firstSweep = await getJob(storageKey);
    expect(firstSweep.state).toBe("pending");
    expect(firstSweep.finalSweepAt).toBeInstanceOf(Date);
    await expect(withStorageKeyRegistration(db, storageKey, async () => "revived")).rejects.toThrow(
      "expired",
    );
    expect(await processStorageCleanupJobs(db, { now })).toMatchObject({ processed: 0 });
    // Simulate an old, still-valid upload URL finishing after the first delete.
    await storage.uploadFileToKey(Buffer.from("late PUT"), storageKey, "text/plain");
    expect(await storage.objectExists(storageKey)).toBe(true);
    if (!firstSweep.finalSweepAt) throw new Error("Expected a final sweep deadline");
    expect(
      await processStorageCleanupJobs(db, {
        now: new Date(firstSweep.finalSweepAt.getTime() + 1),
      }),
    ).toMatchObject({ deleted: 1, failed: 0 });
    expect(await storage.objectExists(storageKey)).toBe(false);
    expect((await getJob(storageKey)).state).toBe("completed");
    await expect(withStorageKeyRegistration(db, storageKey, async () => "revived")).rejects.toThrow(
      "expired",
    );
  });

  it("does not delete a globally shared object, then resumes when its final reference leaves", async () => {
    const storageKey = "cleanup/shared.txt";
    await storage.uploadFileToKey(Buffer.from("shared"), storageKey, "text/plain");
    await db.insert(schema.attachments).values({
      id: "cleanup-shared",
      storageKey,
      fileName: "shared.txt",
      mimeType: "text/plain",
      sizeBytes: 6,
      userId: "other-user",
      spaceId: "other-space",
    });
    await enqueueStorageCleanup(db, { storageKey, kind: "attachment", spaceId: "local" });
    expect(
      await processStorageCleanupJobs(db, { now: new Date(Date.now() + 1_000) }),
    ).toMatchObject({
      retained: 1,
      deleted: 0,
    });
    expect(await storage.objectExists(storageKey)).toBe(true);
    await db.transaction(async (tx) => {
      await enqueueStorageCleanup(tx, { storageKey, kind: "attachment", spaceId: "other-space" });
      await tx.delete(schema.attachments).where(eq(schema.attachments.id, "cleanup-shared"));
    });
    expect(
      await processStorageCleanupJobs(db, { now: new Date(Date.now() + 1_000) }),
    ).toMatchObject({
      deleted: 1,
    });
    expect(await storage.objectExists(storageKey)).toBe(false);
  });

  it("keeps an actual EISDIR deletion failure pending and retries successfully later", async () => {
    const storageKey = "cleanup/retry.txt";
    await mkdir(path.join(storageRoot, storageKey), { recursive: true });
    await enqueueStorageCleanup(db, { storageKey, kind: "attachment", spaceId: "local" });
    const now = new Date(Date.now() + 1_000);
    expect(await processStorageCleanupJobs(db, { now })).toMatchObject({ failed: 1, deleted: 0 });
    const failedJob = await getJob(storageKey);
    expect(failedJob.state).toBe("pending");
    expect(failedJob.attempts).toBe(1);
    expect(failedJob.lastError).toContain("EISDIR");
    expect(await processStorageCleanupJobs(db, { now })).toMatchObject({ processed: 0 });
    // Reopen the actual database to prove the failure/outbox survives a worker
    // restart rather than depending on a process-local retry queue.
    await client.close();
    client = new PGlite(databaseRoot, { extensions: { pg_trgm } });
    db = drizzle({ client, schema });
    expect((await getJob(storageKey)).attempts).toBe(1);
    await rm(path.join(storageRoot, storageKey), { recursive: true });
    await storage.uploadFileToKey(Buffer.from("retry"), storageKey, "text/plain");
    expect(
      await processStorageCleanupJobs(db, { now: new Date(now.getTime() + 30_001) }),
    ).toMatchObject({ deleted: 1, failed: 0 });
    expect((await getJob(storageKey)).attempts).toBe(2);
    expect(await storage.objectExists(storageKey)).toBe(false);
  });

  it("rolls back retirement with its parent transaction and treats missing objects as deleted", async () => {
    const storageKey = "cleanup/rolled-back.txt";
    await expect(
      db.transaction(async (tx) => {
        await enqueueStorageCleanup(tx, { storageKey, kind: "doc", spaceId: "local" });
        throw new Error("rollback purge");
      }),
    ).rejects.toThrow("rollback purge");
    expect(await isStorageKeyRetired(db, storageKey)).toBe(false);
    await enqueueStorageCleanup(db, { storageKey, kind: "doc", spaceId: "local" });
    expect(
      await processStorageCleanupJobs(db, { now: new Date(Date.now() + 1_000) }),
    ).toMatchObject({
      deleted: 1,
    });
    expect((await getJob(storageKey)).state).toBe("completed");
  });

  it("deletes the object without holding the key's row lock, while the key stays retired", async () => {
    const storageKey = "cleanup/unlocked-delete.txt";
    await storage.uploadFileToKey(Buffer.from("bytes"), storageKey, "text/plain");
    await enqueueStorageCleanup(db, { storageKey, kind: "doc", spaceId: "local" });
    let lockedDuringDelete = false;
    let registrationDuringDelete: unknown;
    const remove = LocalStorage.prototype.deleteObject;
    const spy = vi.spyOn(LocalStorage.prototype, "deleteObject").mockImplementation(async function (
      this: LocalStorage,
      key: string,
    ) {
      // Registration and purge take this row lock with a blocking FOR UPDATE;
      // they must not queue behind a (possibly stalled) object delete.
      await withStorageKeyLocks(db, [key], async () => {
        lockedDuringDelete = true;
      });
      registrationDuringDelete = await withStorageKeyRegistration(db, key, async () => "revived")
        .then(() => "accepted")
        .catch((error: unknown) => error);
      return remove.call(this, key);
    });
    try {
      expect(
        await processStorageCleanupJobs(db, { now: new Date(Date.now() + 1_000) }),
      ).toMatchObject({ deleted: 1, failed: 0 });
    } finally {
      spy.mockRestore();
    }
    expect(lockedDuringDelete).toBe(true);
    expect(String(registrationDuringDelete)).toContain("expired");
    expect((await getJob(storageKey)).state).toBe("completed");
    expect(await storage.objectExists(storageKey)).toBe(false);
  });

  it("treats a timed-out delete as a failure to retry, never as a missing object", async () => {
    const storageKey = "cleanup/delete-timeout.txt";
    await storage.uploadFileToKey(Buffer.from("bytes"), storageKey, "text/plain");
    await enqueueStorageCleanup(db, { storageKey, kind: "doc", spaceId: "local" });
    const now = new Date(Date.now() + 1_000);
    const spy = vi
      .spyOn(LocalStorage.prototype, "deleteObject")
      .mockRejectedValueOnce(
        new Error(`Storage delete timed out after 30000ms for "${storageKey}"`),
      );
    try {
      expect(await processStorageCleanupJobs(db, { now })).toMatchObject({ deleted: 0, failed: 1 });
    } finally {
      spy.mockRestore();
    }
    const job = await getJob(storageKey);
    expect(job.state).toBe("pending");
    expect(job.lastError).toContain("timed out");
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    expect(await storage.objectExists(storageKey)).toBe(true);

    // The backoff retry then collects it for real.
    await processStorageCleanupJobs(db, { now: new Date(job.nextAttemptAt.getTime() + 1) });
    expect(await storage.objectExists(storageKey)).toBe(false);
  });

  it("re-claims a job whose worker died mid-delete once its lease lapses", async () => {
    const storageKey = "cleanup/lapsed-claim.txt";
    await storage.uploadFileToKey(Buffer.from("bytes"), storageKey, "text/plain");
    await enqueueStorageCleanup(db, { storageKey, kind: "doc", spaceId: "local" });
    const now = new Date(Date.now() + 1_000);
    // A worker that crashed after committing its claim leaves exactly this row.
    await db
      .update(schema.busabaseStorageCleanupJobs)
      .set({
        state: "processing",
        attempts: 1,
        nextAttemptAt: new Date(now.getTime() + 3 * 60 * 1000),
      })
      .where(eq(schema.busabaseStorageCleanupJobs.storageKey, storageKey));
    await expect(withStorageKeyRegistration(db, storageKey, async () => "revived")).rejects.toThrow(
      "expired",
    );
    expect(await processStorageCleanupJobs(db, { now })).toMatchObject({ processed: 0 });
    expect(
      await processStorageCleanupJobs(db, {
        now: new Date(now.getTime() + 3 * 60 * 1000 + 1),
      }),
    ).toMatchObject({ deleted: 1 });
    const done = await getJob(storageKey);
    expect(done.state).toBe("completed");
    expect(done.attempts).toBe(2);
    expect(await storage.objectExists(storageKey)).toBe(false);
  });
});
