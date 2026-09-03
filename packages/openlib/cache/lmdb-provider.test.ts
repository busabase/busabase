import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LmdbCacheProvider } from "./lmdb-provider";

describe("LmdbCacheProvider", () => {
  let provider: LmdbCacheProvider;
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lmdb-test-"));
    provider = new LmdbCacheProvider(tempDir);
  });

  afterAll(async () => {
    await provider.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Key-Value ──────────────────────────────────────────────

  it("should set and get a value", async () => {
    await provider.set("key1", "value1");
    const result = await provider.get("key1");
    expect(result).toBe("value1");
  });

  it("should return null for non-existent key", async () => {
    const result = await provider.get("nonexistent");
    expect(result).toBeNull();
  });

  it("should delete a key", async () => {
    await provider.set("key2", "value2");
    await provider.del("key2");
    const result = await provider.get("key2");
    expect(result).toBeNull();
  });

  it("should expire a key after TTL", async () => {
    await provider.set("ttl-key", "ttl-value", 1);
    const before = await provider.get("ttl-key");
    expect(before).toBe("ttl-value");

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const after = await provider.get("ttl-key");
    expect(after).toBeNull();
  });

  it("should refresh TTL only for the current owner value", async () => {
    await provider.set("presence-refresh", "owner-new", 1);

    await expect(provider.refreshTtlIfValue("presence-refresh", "owner-old", 60)).resolves.toBe(
      false,
    );
    await expect(provider.refreshTtlIfValue("presence-refresh", "owner-new", 60)).resolves.toBe(
      true,
    );
    await expect(provider.get("presence-refresh")).resolves.toBe("owner-new");
  });

  it("should delete only the current owner value", async () => {
    await provider.set("presence-delete", "owner-new", 60);

    await expect(provider.deleteIfValue("presence-delete", "owner-old")).resolves.toBe(false);
    await expect(provider.get("presence-delete")).resolves.toBe("owner-new");
    await expect(provider.deleteIfValue("presence-delete", "owner-new")).resolves.toBe(true);
    await expect(provider.get("presence-delete")).resolves.toBeNull();
  });

  // ── Sorted Set ─────────────────────────────────────────────

  it("should add and retrieve sorted set members by score", async () => {
    await provider.zAdd("tasks", { value: "task1", score: 100 });
    await provider.zAdd("tasks", { value: "task2", score: 200 });
    await provider.zAdd("tasks", { value: "task3", score: 300 });

    const results = await provider.zRangeByScore("tasks", 0, 250);
    expect(results).toEqual(["task1", "task2"]);
  });

  it("should remove a sorted set member", async () => {
    await provider.zRem("tasks", "task2");
    const results = await provider.zRangeByScore("tasks", 0, 500);
    expect(results).toEqual(["task1", "task3"]);
  });

  it("should get sorted set cardinality", async () => {
    const count = await provider.zCard("tasks");
    expect(count).toBe(2);
  });

  it("should get sorted set members with scores", async () => {
    const results = await provider.zRangeWithScores("tasks", 0, 0);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ value: "task1", score: 100 });
  });

  // ── Locking ────────────────────────────────────────────────

  it("should acquire and release a lock", async () => {
    const acquired = await provider.acquireLock("test-lock", 60);
    expect(acquired).toBe(true);

    // Same lock should fail
    const again = await provider.acquireLock("test-lock", 60);
    expect(again).toBe(false);

    await provider.releaseLock("test-lock");

    // Should succeed after release
    const reacquired = await provider.acquireLock("test-lock", 60);
    expect(reacquired).toBe(true);

    await provider.releaseLock("test-lock");
  });

  // ── Batch ──────────────────────────────────────────────────

  it("should execute multi operations", async () => {
    await provider.multi([
      { op: "zAdd", key: "batch", member: { value: "b1", score: 10 } },
      { op: "zAdd", key: "batch", member: { value: "b2", score: 20 } },
    ]);

    const results = await provider.zRangeByScore("batch", 0, 100);
    expect(results).toEqual(["b1", "b2"]);
  });
});
