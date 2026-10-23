import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeDependencyFiles,
  dependencyCacheKey,
  dependencyFilesFromSnapshot,
  encodeDependencyFiles,
  evictCachedDependencies,
  loadCachedDependencies,
  storeCachedDependencies,
} from "../src/domains/airapp/components/runners/dependency-cache";
import { createFakeCacheStorage } from "./helpers/fake-cache-storage";

const node = { runtime: "node", install: "npm install" } as const;
const manifest = JSON.stringify({ dependencies: { hono: "^4.12.29" } });
const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("dependencyCacheKey", () => {
  let fake: ReturnType<typeof createFakeCacheStorage>;
  beforeEach(() => {
    fake = createFakeCacheStorage();
    vi.stubGlobal("caches", fake.storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is stable for the same manifest, lockfile and install command", async () => {
    const files = { "package.json": manifest, "server.js": "// a" };
    const key = await dependencyCacheKey(files, node);
    expect(key).toMatch(/^https:\/\/airapp-dependencies\.invalid\/[0-9a-f]{64}$/);
    // App code is not part of the key: editing server.js keeps the cache.
    expect(await dependencyCacheKey({ ...files, "server.js": "// b" }, node)).toBe(key);
  });

  it("changes when anything the install depends on changes", async () => {
    const files = { "package.json": manifest };
    const key = await dependencyCacheKey(files, node);
    expect(await dependencyCacheKey({ "package.json": `${manifest}\n` }, node)).not.toBe(key);
    expect(await dependencyCacheKey({ ...files, "package-lock.json": "{}" }, node)).not.toBe(key);
    expect(await dependencyCacheKey(files, { runtime: "node", install: "npm ci" })).not.toBe(key);
  });

  it("refuses runs it cannot restore faithfully", async () => {
    const files = { "package.json": manifest };
    expect(
      await dependencyCacheKey(files, { runtime: "python", install: "npm install" }),
    ).toBeNull();
    expect(
      await dependencyCacheKey(files, { runtime: "node", install: "npm install && npm run build" }),
    ).toBeNull();
    expect(await dependencyCacheKey({ "server.js": "" }, node)).toBeNull();
    vi.stubGlobal("caches", undefined);
    expect(await dependencyCacheKey(files, node)).toBeNull();
  });
});

describe("dependencyFilesFromSnapshot", () => {
  it("keeps only node_modules files, relative to the workdir, as bytes", () => {
    const files = dependencyFilesFromSnapshot({
      entries: [
        { path: "/", kind: "directory" },
        { path: "/server.js", kind: "file", data: b64("app") },
        { path: "/node_modules", kind: "directory" },
        { path: "/node_modules/hono/index.js", kind: "file", data: b64("export {}") },
        { path: "/node_modules/.bin/hono", kind: "file", data: b64('node "x" "$@"\n') },
      ],
    });
    expect(Object.keys(files ?? {}).sort()).toEqual([
      "node_modules/.bin/hono",
      "node_modules/hono/index.js",
    ]);
    expect(new TextDecoder().decode(files?.["node_modules/hono/index.js"])).toBe("export {}");
  });

  it("gives up on trees boot({ files }) cannot reproduce or that are too large", () => {
    expect(
      dependencyFilesFromSnapshot({
        entries: [{ path: "/node_modules/linked", kind: "symlink", target: "../pkg" }],
      }),
    ).toBeNull();
    expect(
      dependencyFilesFromSnapshot(
        { entries: [{ path: "/node_modules/a.js", kind: "file", data: b64("12345") }] },
        4,
      ),
    ).toBeNull();
    expect(dependencyFilesFromSnapshot({ entries: [] })).toBeNull();
  });
});

describe("dependency cache storage", () => {
  let fake: ReturnType<typeof createFakeCacheStorage>;
  beforeEach(() => {
    fake = createFakeCacheStorage();
    vi.stubGlobal("caches", fake.storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips text, binary and empty files byte for byte", async () => {
    const files = {
      "node_modules/a/index.js": new TextEncoder().encode("module.exports = 1"),
      "node_modules/a/blob.bin": new Uint8Array([0, 255, 1, 254]),
      "node_modules/a/empty": new Uint8Array(),
    };
    const decoded = decodeDependencyFiles(await encodeDependencyFiles(files).arrayBuffer());
    expect(Object.keys(decoded)).toEqual(Object.keys(files));
    for (const [path, bytes] of Object.entries(files)) {
      expect(Array.from(decoded[path])).toEqual(Array.from(bytes));
    }
  });

  it("stores, loads and evicts an entry", async () => {
    const key = "https://airapp-dependencies.invalid/abc";
    expect(await loadCachedDependencies(key)).toBeNull();
    await storeCachedDependencies(key, { "node_modules/x.js": new Uint8Array([1, 2]) });
    const loaded = await loadCachedDependencies(key);
    expect(Array.from(loaded?.["node_modules/x.js"] ?? [])).toEqual([1, 2]);
    await evictCachedDependencies(key);
    expect(await loadCachedDependencies(key)).toBeNull();
  });

  it("treats a truncated or corrupt entry as a miss", async () => {
    const key = "https://airapp-dependencies.invalid/bad";
    const whole = await encodeDependencyFiles({
      "node_modules/x.js": new Uint8Array(10),
    }).arrayBuffer();
    fake.entries.set(key, whole.slice(0, whole.byteLength - 3));
    expect(await loadCachedDependencies(key)).toBeNull();
    fake.entries.set(key, new Uint8Array([0, 0, 0, 9, 1, 2]).buffer);
    expect(await loadCachedDependencies(key)).toBeNull();
  });
});
