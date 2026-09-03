import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCache } from "./index";

/**
 * Integration test: verify lmdb:// protocol creates a working LMDB cache provider.
 * Mirrors the real flow: REDIS_URL="lmdb://./.data/cache" → LMDB provider.
 */
describe("LMDB protocol integration", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lmdb-integration-"));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lmdb:// path → working LMDB provider with get/set/del", async () => {
    const lmdbPath = join(tempDir, "cache");
    const provider = await createCache({ provider: "lmdb", lmdbPath });

    expect(provider.name).toBe("lmdb");

    await provider.set("key", "value", 60);
    expect(await provider.get("key")).toBe("value");

    await provider.del("key");
    expect(await provider.get("key")).toBeNull();

    await provider.close();
  });

  it("lmdb:// sorted set operations work", async () => {
    const lmdbPath = join(tempDir, "cache-zset");
    const provider = await createCache({ provider: "lmdb", lmdbPath });

    await provider.zAdd("scores", { value: "alice", score: 10 });
    await provider.zAdd("scores", { value: "bob", score: 20 });

    expect(await provider.zCard("scores")).toBe(2);
    expect(await provider.zRangeByScore("scores", 0, 15)).toEqual(["alice"]);

    await provider.close();
  });
});
