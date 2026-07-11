import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the local-provider branch of `openAssetTextSource`
 * (`packages/busabase-core/src/domains/assets/logic/text-cache.ts`).
 *
 * It used to do `const buffer = await storage.getObject(row.textStorageKey)`
 * and iterate the whole in-memory buffer — defeating the feature's "bounded
 * memory" promise on exactly the single-machine/PGLite deployment mode the
 * spec repeatedly promises parity for. The fix streams the real fs path
 * directly (`getLocalStoragePath` + `iterateLinesFromFile`), never buffering
 * the whole object.
 *
 * `openlib/storage` is fully mocked here (rather than pointed at a real
 * `LocalStorage` instance) so `storage.getObject` can be asserted as NEVER
 * called — the most direct, concrete way to prove the local branch doesn't
 * buffer the whole object, without relying on process-memory measurements.
 */

const getObjectMock = vi.fn(async () => {
  throw new Error(
    "storage.getObject should never be called by the local-provider streaming read path",
  );
});

let localDir = "";

vi.mock("openlib/storage", () => ({
  isLocalStorageProvider: () => true,
  storage: {
    getObject: getObjectMock,
    objectExists: async (key: string) => {
      const fs = await import("node:fs/promises");
      try {
        await fs.access(path.join(localDir, key));
        return true;
      } catch {
        return false;
      }
    },
  },
  getLocalStoragePath: (key: string) => path.join(localDir, key),
}));

describe("openAssetTextSource — local provider streams instead of buffering (bounded memory)", () => {
  beforeAll(async () => {
    localDir = await mkdtemp(path.join(os.tmpdir(), "busabase-text-cache-local-"));
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    await writeFile(path.join(localDir, "big.txt"), lines, "utf8");
  });

  afterAll(async () => {
    if (localDir) await rm(localDir, { recursive: true, force: true });
  });

  it("iterates real lines off disk without ever calling storage.getObject", async () => {
    const { openAssetTextSource } = await import("../src/domains/assets/logic/text-cache");
    const source = await openAssetTextSource({ textStorageKey: "big.txt", textContentHash: null });

    const collected: string[] = [];
    for await (const line of source.iterateLines(0)) {
      collected.push(line);
      if (collected.length >= 3) break;
    }

    expect(collected).toEqual(["line 0", "line 1", "line 2"]);
    expect(getObjectMock).not.toHaveBeenCalled();
  });

  it("honors a nonzero startByteOffset via the real fs stream, still without buffering", async () => {
    const { openAssetTextSource } = await import("../src/domains/assets/logic/text-cache");
    const source = await openAssetTextSource({ textStorageKey: "big.txt", textContentHash: null });

    // "line 0\n" is 7 bytes — start right after it.
    const collected: string[] = [];
    for await (const line of source.iterateLines(7)) {
      collected.push(line);
      if (collected.length >= 2) break;
    }

    expect(collected).toEqual(["line 1", "line 2"]);
    expect(getObjectMock).not.toHaveBeenCalled();
  });

  it("throws a not-found error for a missing key without calling storage.getObject", async () => {
    const { openAssetTextSource } = await import("../src/domains/assets/logic/text-cache");
    await expect(
      openAssetTextSource({ textStorageKey: "missing.txt", textContentHash: null }),
    ).rejects.toThrow(/not found/i);
    expect(getObjectMock).not.toHaveBeenCalled();
  });
});
