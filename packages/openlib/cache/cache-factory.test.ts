import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCache } from "./index";
import type { CacheProvider } from "./types";

describe("Cache Provider Factory", () => {
  let tempDir: string;
  let provider: CacheProvider | null = null;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cache-factory-test-"));
  });

  afterEach(async () => {
    if (provider) {
      await provider.close();
      provider = null;
    }
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create an LMDB provider", async () => {
    provider = await createCache({ provider: "lmdb", lmdbPath: tempDir });
    expect(provider.name).toBe("lmdb");

    await provider.set("test", "value");
    const result = await provider.get("test");
    expect(result).toBe("value");
  });

  it("should throw for unknown provider", async () => {
    await expect(createCache({ provider: "unknown" as "redis", redisUrl: "test" })).rejects.toThrow(
      "Unknown cache provider",
    );
  });
});
