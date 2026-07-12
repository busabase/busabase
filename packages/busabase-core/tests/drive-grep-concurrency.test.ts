import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Drive Grep Retrieval P1 — concurrency-pool coverage. Mirrors the harness in
 * drive-grep-retrieval.test.ts (real oRPC router, real temp PGLite DB, real
 * local storage) so these tests exercise the exact `grepAssets` code path a
 * caller hits, not a reimplementation.
 *
 * Every pattern here contains a regex metacharacter (`\d`), so `isLiteralPattern`
 * always classifies it as non-literal — these tests always exercise the JS
 * scanner's concurrency pool, independent of whether `rg` happens to be
 * installed on the machine running the suite. (Literal-pattern / `rg` routing
 * has its own dedicated coverage in drive-grep-rg*.test.ts.)
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;
/** 16 distinct single hex chars — enough unique `HASH()` seeds for every asset these tests create. */
const HEX_DIGITS = "0123456789abcdef";

const expectDefined = <T>(value: T | undefined | null): T => {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  if (value === undefined || value === null) throw new Error("Expected value to be defined");
  return value;
};

describe("Drive Grep Retrieval — concurrency pool (BUSABASE_GREP_CONCURRENCY)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let previousConcurrency: string | undefined;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-conc-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-conc-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    previousConcurrency = process.env.BUSABASE_GREP_CONCURRENCY;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (previousConcurrency === undefined) delete process.env.BUSABASE_GREP_CONCURRENCY;
    else process.env.BUSABASE_GREP_CONCURRENCY = previousConcurrency;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  /** Upload+confirm a small asset, returning its assetId. */
  const uploadAsset = async (opts: { fileName: string; hashByte: string }) => {
    const contentHash = HASH(opts.hashByte);
    const req = await client.assets.createUploadUrl({
      fileName: opts.fileName,
      mimeType: "text/plain",
      sizeBytes: 100,
      contentHash,
    });
    const confirmed = await client.assets.confirm({
      storageKey: req.storageKey,
      fileName: opts.fileName,
      mimeType: "text/plain",
      sizeBytes: 100,
      contentHash,
    });
    return { assetId: expectDefined(confirmed.assetId) };
  };

  const padding = (lines: number, prefix: string) =>
    Array.from({ length: lines }, (_, i) => `${prefix} filler line ${i}`).join("\n");

  it("returns matches in original candidate order (not completion order) with correct filesScanned, across multiple batches", async () => {
    process.env.BUSABASE_GREP_CONCURRENCY = "3"; // 6 candidates / batch size 3 = 2 batches

    const candidateCount = 6;
    const assetIds: string[] = [];
    for (let i = 0; i < candidateCount; i++) {
      const { assetId } = await uploadAsset({
        fileName: `concurrency-${i}.log`,
        hashByte: HEX_DIGITS[i],
      });
      assetIds.push(assetId);
    }

    // Vary each candidate's file size so JS-scan duration differs across
    // candidates within the same batch — the first candidate in each batch
    // is deliberately the "slowest" (most lines to iterate before its
    // match), so a completion-order bug (pushing whichever file's scan
    // resolves first) would visibly reorder `matches` relative to
    // `assetIds`. A batch-index-order-preserving implementation must still
    // report matches in `assetIds` order regardless.
    const slowFirstInBatch = [0, 3]; // batch 0 → index 0, batch 1 → index 3 (batch size 3)
    for (let i = 0; i < candidateCount; i++) {
      const lineCount = slowFirstInBatch.includes(i) ? 4000 : 5;
      const text = `${padding(lineCount, `pad${i}`)}\nneedle-match-${i}\n${padding(5, `tail${i}`)}`;
      await client.assets.putText({ assetId: assetIds[i], text });
    }

    const result = await client.assets.grep({
      pattern: "needle-match-\\d",
      scope: { assetIds },
      maxMatches: 100,
    });

    expect(result.filesScanned).toBe(candidateCount);
    expect(result.errored).toHaveLength(0);
    expect(result.matches).toHaveLength(candidateCount);
    // Order must match `assetIds` order exactly — candidate i's match before
    // candidate i+1's, regardless of which file's scan actually finished
    // first.
    expect(result.matches.map((m) => m.assetId)).toEqual(assetIds);
    for (let i = 0; i < candidateCount; i++) {
      expect(result.matches[i]?.text).toBe(`needle-match-${i}`);
    }
  });

  it("enforces the maxMatches budget across concurrent batches: truncated, accurate notReached, and never over budget", async () => {
    process.env.BUSABASE_GREP_CONCURRENCY = "4";

    const candidateCount = 10;
    const assetIds: string[] = [];
    for (let i = 0; i < candidateCount; i++) {
      const { assetId } = await uploadAsset({
        fileName: `budget-${i}.log`,
        hashByte: HEX_DIGITS[i],
      });
      assetIds.push(assetId);
      // Every candidate matches exactly once.
      await client.assets.putText({ assetId, text: `budget-needle-${i} present` });
    }

    const maxMatches = 3; // far below candidateCount, with concurrency > 1
    const result = await client.assets.grep({
      pattern: "budget-needle-\\d",
      scope: { assetIds },
      maxMatches,
    });

    expect(result.truncated).toBe(true);
    expect(result.matches.length).toBeLessThanOrEqual(maxMatches);
    // Every candidate is either scanned, errored, or notReached — accounted for.
    expect(result.filesScanned + result.errored.length + result.notReached).toBe(candidateCount);
    // With a budget this far below candidateCount, at least some candidates
    // must have been left unreached.
    expect(result.notReached).toBeGreaterThan(0);
  });
});
