import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Doc-body grep cache (`openMutableTextSource` in
 * `src/domains/assets/logic/text-cache.ts`, consumed by
 * `logic/node-content.ts`'s `openNodeContentSource` / `readNodeLines`).
 *
 * Before this cache existed, every single Unified Grep call re-downloaded
 * EVERY candidate Doc's full body from object storage. A Doc body has no DB
 * row and therefore no immutable content hash to key a cache on (unlike the
 * Files path), so validity comes from a body-free `getObjectMetadata` probe.
 * That makes staleness — an edited Doc still grepping as its old content —
 * the failure mode worth the most test weight here.
 *
 * `openlib/storage` is fully faked (same approach as
 * `text-cache-local-streaming.test.ts`) with `isLocalStorageProvider()`
 * returning FALSE, so the remote-provider branch under test actually runs, and
 * so every storage read can be counted: the perf claim is only meaningful as
 * an assertion on download COUNT.
 */

interface FakeObject {
  body: Buffer;
  lastModified: Date;
}

const objects = new Map<string, FakeObject>();
const calls = { metadata: 0, range: 0, whole: 0 };
/** When set, storage body reads block on this — used to force real concurrency. */
let downloadGate: Promise<void> | null = null;

const resetCalls = () => {
  calls.metadata = 0;
  calls.range = 0;
  calls.whole = 0;
};

/** Total storage reads that actually transfer a body (metadata probes excluded). */
const bodyDownloads = () => calls.range + calls.whole;

vi.mock("openlib/storage", () => ({
  isLocalStorageProvider: () => false,
  getLocalStoragePath: () => {
    throw new Error("getLocalStoragePath must not be reached on a remote provider");
  },
  storage: {
    objectExists: async (key: string) => objects.has(key),
    getObjectMetadata: async (key: string) => {
      calls.metadata++;
      const object = objects.get(key);
      return object ? { key, size: object.body.length, lastModified: object.lastModified } : null;
    },
    getObject: async (key: string) => {
      calls.whole++;
      if (downloadGate) await downloadGate;
      const object = objects.get(key);
      if (!object) throw new Error(`No such object: ${key}`);
      return object.body;
    },
    getObjectRange: async (key: string, start: number, end: number) => {
      calls.range++;
      if (downloadGate) await downloadGate;
      const object = objects.get(key);
      if (!object) throw new Error(`No such object: ${key}`);
      return object.body.subarray(start, Math.min(end + 1, object.body.length));
    },
  },
}));

const docBodyKey = (nodeId: string) => `busabase/nodes/${nodeId}/doc/doc.md`;

/** Comfortably older than MUTABLE_CACHE_SETTLE_MS, so entries are cacheable. */
const settled = (offsetMs = 0) => new Date(Date.now() - 60_000 + offsetMs);

const putDoc = (nodeId: string, body: string, lastModified: Date) => {
  objects.set(docBodyKey(nodeId), { body: Buffer.from(body, "utf8"), lastModified });
};

let cacheDir = "";

const cacheFiles = async (): Promise<string[]> => {
  try {
    return (await readdir(cacheDir)).filter((name) => name.startsWith("mut-"));
  } catch {
    return [];
  }
};

// Repointed from `domains/doc/handlers.ts` to the node-content registry: the
// Doc-only `readDocBodyForGrep`/`openDocBodySource` were folded into the
// type-agnostic `openNodeContentSource`, which builds the SAME `doc:<nodeId>`
// cache key against the SAME storage key. Every invariant below (staleness,
// settle window, coalescing, prune/evict survival, budget) is unchanged —
// only the entry point moved.
const loadDocHandlers = async () => {
  const { openNodeContentSource } = await import("../src/logic/node-content");
  return {
    openDocBodySource: (nodeId: string) => openNodeContentSource("doc", nodeId),
    readDocBodyForGrep: async (nodeId: string) =>
      (await openNodeContentSource("doc", nodeId)).readText(),
  };
};

describe("Doc body grep cache — metadata-validated local disk cache", () => {
  beforeAll(async () => {
    cacheDir = await mkdtemp(path.join(os.tmpdir(), "busabase-doc-grep-cache-"));
    process.env.BUSABASE_GREP_CACHE_DIR = cacheDir;
  });

  afterAll(async () => {
    delete process.env.BUSABASE_GREP_CACHE_DIR;
    if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    objects.clear();
    downloadGate = null;
    resetCalls();
    // Fresh cache directory contents per test so download counts are absolute,
    // not relative to whatever a previous test happened to leave warmed.
    for (const name of await cacheFiles()) {
      await rm(path.join(cacheDir, name), { force: true });
    }
  });

  afterEach(() => {
    delete process.env.BUSABASE_GREP_CACHE_MAX_BYTES;
  });

  it("downloads once, then serves repeat greps from the local cache", async () => {
    const { readDocBodyForGrep } = await loadDocHandlers();
    putDoc("nod_perf", "alpha\nbeta\ngamma\n", settled());

    expect(await readDocBodyForGrep("nod_perf")).toBe("alpha\nbeta\ngamma\n");
    expect(bodyDownloads()).toBe(1);

    expect(await readDocBodyForGrep("nod_perf")).toBe("alpha\nbeta\ngamma\n");
    expect(await readDocBodyForGrep("nod_perf")).toBe("alpha\nbeta\ngamma\n");

    // THE perf win: two further greps of the same unchanged Doc transferred no
    // body at all.
    expect(bodyDownloads()).toBe(1);
    // ...but each one still paid the mandatory (body-free) validity probe. If
    // this ever drops below one probe per call, invalidation has been
    // optimized away and staleness becomes possible.
    expect(calls.metadata).toBe(3);
  });

  it("re-downloads when the edit changed lastModified (never serves stale content)", async () => {
    const { readDocBodyForGrep } = await loadDocHandlers();
    putDoc("nod_edit", "before the edit\n", settled());
    expect(await readDocBodyForGrep("nod_edit")).toBe("before the edit\n");
    expect(bodyDownloads()).toBe(1);

    // Same byte length, different bytes, different second — the invalidation
    // signal is lastModified alone here.
    putDoc("nod_edit", "after,, the edit\n", settled(5_000));
    expect(await readDocBodyForGrep("nod_edit")).toBe("after,, the edit\n");
    expect(bodyDownloads()).toBe(2);
  });

  it("re-downloads when only the size changed (same lastModified second)", async () => {
    const { readDocBodyForGrep } = await loadDocHandlers();
    const sameInstant = settled();
    putDoc("nod_size", "short\n", sameInstant);
    expect(await readDocBodyForGrep("nod_size")).toBe("short\n");
    expect(bodyDownloads()).toBe(1);

    // An edit landing inside the SAME 1-second lastModified bucket. Only the
    // size comparison can catch this one.
    putDoc("nod_size", "noticeably longer body\n", sameInstant);
    expect(await readDocBodyForGrep("nod_size")).toBe("noticeably longer body\n");
    expect(bodyDownloads()).toBe(2);
  });

  it("refuses to cache an object still inside its lastModified second (same-size hole)", async () => {
    const { readDocBodyForGrep } = await loadDocHandlers();
    // A Doc written just now: its 1-second lastModified bucket is still open,
    // so another edit could land in it and report identical metadata.
    putDoc("nod_fresh", "typo: teh cat\n", new Date());
    expect(await readDocBodyForGrep("nod_fresh")).toBe("typo: teh cat\n");
    expect(await cacheFiles()).toHaveLength(0);

    // Same second, IDENTICAL byte length — indistinguishable by metadata. A
    // cache that had persisted the first read would serve "teh" forever.
    putDoc("nod_fresh", "typo: the cat\n", new Date());
    expect(await readDocBodyForGrep("nod_fresh")).toBe("typo: the cat\n");
    expect(await cacheFiles()).toHaveLength(0);
  });

  it("coalesces concurrent first reads of the same Doc into one download", async () => {
    const { readDocBodyForGrep } = await loadDocHandlers();
    putDoc("nod_race", "shared body\n", settled());

    let release = () => {};
    downloadGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const readers = Promise.all([
      readDocBodyForGrep("nod_race"),
      readDocBodyForGrep("nod_race"),
      readDocBodyForGrep("nod_race"),
      readDocBodyForGrep("nod_race"),
    ]);
    // Let all four reach the (blocked) storage layer before unblocking it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();

    expect(await readers).toEqual([
      "shared body\n",
      "shared body\n",
      "shared body\n",
      "shared body\n",
    ]);
    expect(bodyDownloads()).toBe(1);
  });

  /**
   * A source hands back a `filePath` but opens it LAZILY, so the cache's own
   * housekeeping can unlink that file in the window before the holder reads:
   * request A opens a source, the Doc is edited, request B downloads the new
   * version and prunes A's now-superseded entry, and only then does A read.
   * Before this cache existed there was no file to delete and this simply
   * worked, so an ENOENT here would be a robustness regression introduced by
   * caching — grep would report the Doc as `errored` where it used to return
   * content.
   *
   * CHOSEN SEMANTICS: the stranded reader gets the object's CURRENT content
   * ("v2 after the edit"), NOT a snapshot of what the body was when its source
   * was opened. Stated explicitly because it is a real choice: the open-time
   * bytes are already gone, and pinning them would mean holding an open fd for
   * every source a caller might never consume. Current content is also the
   * better answer for a search surface, and is exactly what the pre-cache code
   * (which fetched at read time) would have returned.
   */
  it("serves a reader whose cache entry was pruned underneath it, without throwing", async () => {
    const { openDocBodySource, readDocBodyForGrep } = await loadDocHandlers();
    putDoc("nod_stranded", "v1 before the edit\n", settled());

    // Request A: opens a source and holds it WITHOUT consuming it yet.
    const stranded = await openDocBodySource("nod_stranded");
    expect(stranded.filePath).toBeTruthy();

    // The Doc is edited, then request B downloads the new version — which
    // prunes the entry request A is still holding a path to.
    putDoc("nod_stranded", "v2 after the edit\n", settled(5_000));
    expect(await readDocBodyForGrep("nod_stranded")).toBe("v2 after the edit\n");
    await expect(stat(stranded.filePath as string)).rejects.toThrow(/ENOENT/);

    // A now reads. It must not throw; it gets the CURRENT body.
    expect(await stranded.readText()).toBe("v2 after the edit\n");

    const lines: string[] = [];
    for await (const line of stranded.iterateLines()) lines.push(line);
    expect(lines).toEqual(["v2 after the edit"]);
  });

  it("serves a reader whose cache entry was LRU-evicted underneath it", async () => {
    const { openDocBodySource, readDocBodyForGrep } = await loadDocHandlers();
    putDoc("nod_evicted", `${"e".repeat(999)}\n`, settled());
    putDoc("nod_other", `${"o".repeat(1_001)}\n`, settled());

    const stranded = await openDocBodySource("nod_evicted");

    // A concurrent request for a DIFFERENT Doc pushes the directory over
    // budget and evicts the entry above — a distinct deletion path from the
    // prune case, with the same lazy-open exposure.
    process.env.BUSABASE_GREP_CACHE_MAX_BYTES = "1500";
    await readDocBodyForGrep("nod_other");
    await expect(stat(stranded.filePath as string)).rejects.toThrow(/ENOENT/);

    expect(await stranded.readText()).toBe(`${"e".repeat(999)}\n`);
  });

  it("does not restart a partially-consumed iteration when the entry vanishes", async () => {
    const { openDocBodySource } = await loadDocHandlers();
    putDoc("nod_partial", "l1\nl2\nl3\nl4\n", settled());
    const source = await openDocBodySource("nod_partial");

    // Delete the entry mid-iteration. POSIX keeps the already-open fd
    // readable, so the read completes from the unlinked file — the fallback
    // must NOT kick in and re-emit lines the caller already saw.
    const seen: string[] = [];
    for await (const line of source.iterateLines()) {
      seen.push(line);
      if (seen.length === 1) await rm(source.filePath as string, { force: true });
    }
    expect(seen).toEqual(["l1", "l2", "l3", "l4"]);
  });

  it("prunes a Doc's superseded cache entry instead of accumulating one per edit", async () => {
    const { readDocBodyForGrep } = await loadDocHandlers();
    putDoc("nod_prune", "v1\n", settled());
    await readDocBodyForGrep("nod_prune");
    expect(await cacheFiles()).toHaveLength(1);

    putDoc("nod_prune", "v2 is longer\n", settled(1_000));
    await readDocBodyForGrep("nod_prune");
    const remaining = await cacheFiles();
    expect(remaining).toHaveLength(1);

    putDoc("nod_prune", "v3 is longer still\n", settled(2_000));
    await readDocBodyForGrep("nod_prune");
    expect(await cacheFiles()).toHaveLength(1);
    expect(await readDocBodyForGrep("nod_prune")).toBe("v3 is longer still\n");
  });

  it("participates in the shared byte budget / LRU eviction", async () => {
    const { readDocBodyForGrep } = await loadDocHandlers();
    const bodyA = `${"x".repeat(999)}\n`;
    const bodyB = `${"y".repeat(1_001)}\n`;
    putDoc("nod_a", bodyA, settled());
    putDoc("nod_b", bodyB, settled());

    await readDocBodyForGrep("nod_a");
    // Budget is enforced on write-through, so it must be in place before the
    // read that pushes the directory over it.
    process.env.BUSABASE_GREP_CACHE_MAX_BYTES = "1500";
    // Returns the freshly-downloaded body, NOT ENOENT: eviction must never
    // delete the entry the very download that triggered it just produced
    // (their atimes can tie, and a just-read older entry's atime is newer).
    expect(await readDocBodyForGrep("nod_b")).toBe(bodyB);

    const remaining = await cacheFiles();
    const total = (
      await Promise.all(remaining.map(async (name) => (await stat(path.join(cacheDir, name))).size))
    ).reduce((sum, size) => sum + size, 0);
    expect(total).toBeLessThanOrEqual(1500);
    expect(remaining).toHaveLength(1);

    // The evicted Doc is a cache miss, not a wrong answer — it re-downloads.
    resetCalls();
    expect(await readDocBodyForGrep("nod_a")).toBe(bodyA);
    expect(bodyDownloads()).toBe(1);
  });

  it("surfaces a missing body object as an error (grep must count it as errored)", async () => {
    const { readDocBodyForGrep } = await loadDocHandlers();
    await expect(readDocBodyForGrep("nod_absent")).rejects.toThrow(/not found/i);
    expect(bodyDownloads()).toBe(0);
  });

  it("exposes an on-disk filePath for a cached body (keeps the rg door open)", async () => {
    const { openDocBodySource } = await loadDocHandlers();
    putDoc("nod_rg", "needle here\nother line\n", settled());
    const source = await openDocBodySource("nod_rg");

    expect(source.filePath).toBeTruthy();
    expect(source.filePath?.startsWith(cacheDir)).toBe(true);

    const lines: string[] = [];
    for await (const line of source.iterateLines()) lines.push(line);
    // No phantom trailing empty line — same convention as splitDocLines/readline.
    expect(lines).toEqual(["needle here", "other line"]);
  });

  it("iterates an uncached (settle-window) body with the same line conventions", async () => {
    const { openDocBodySource } = await loadDocHandlers();
    putDoc("nod_win", "one\r\ntwo\r\nthree", new Date());
    const source = await openDocBodySource("nod_win");

    expect(source.filePath).toBeUndefined();
    const lines: string[] = [];
    for await (const line of source.iterateLines()) lines.push(line);
    expect(lines).toEqual(["one", "two", "three"]);
  });
});

describe("Files/attachment cache is unchanged by the shared-download extraction", () => {
  beforeAll(async () => {
    if (!cacheDir) {
      cacheDir = await mkdtemp(path.join(os.tmpdir(), "busabase-doc-grep-cache-"));
    }
    process.env.BUSABASE_GREP_CACHE_DIR = cacheDir;
  });

  beforeEach(() => {
    objects.clear();
    downloadGate = null;
    resetCalls();
  });

  it("still keys on the immutable content hash and downloads exactly once", async () => {
    const { openAssetTextSource } = await import("../src/domains/assets/logic/text-cache");
    const hash = `sha256:${"a".repeat(64)}`;
    objects.set("assets/file.txt", {
      body: Buffer.from("asset line 1\nasset line 2\n", "utf8"),
      lastModified: new Date(),
    });

    const read = async () => {
      const source = await openAssetTextSource({
        textStorageKey: "assets/file.txt",
        textContentHash: hash,
      });
      const lines: string[] = [];
      for await (const line of source.iterateLines()) lines.push(line);
      return lines;
    };

    expect(await read()).toEqual(["asset line 1", "asset line 2"]);
    expect(await read()).toEqual(["asset line 1", "asset line 2"]);
    expect(bodyDownloads()).toBe(1);
    // The Files path is hash-keyed and must NEVER pay a metadata probe — that
    // is the whole point of an immutable key.
    expect(calls.metadata).toBe(0);
  });
});
