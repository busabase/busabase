import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resetStorage, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusabaseDatabase } from "../src/context";
import * as schema from "../src/db/schema";
import {
  enqueueStorageCleanup,
  isStorageKeyRetired,
  processStorageCleanupJobs,
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
});
