/**
 * Grep engine performance benchmark.
 *
 * Measures the actual streaming-scan engine
 * (`src/logic/grep.ts` + `src/domains/assets/logic/asset-grep-logic.ts`),
 * not HTTP/Next.js overhead — boots a real PGLite DB + local filesystem
 * storage and drives grep through the real oRPC router
 * (`createRouterClient(busabaseRouter)`), the same harness
 * `tests/drive-grep-*.test.ts` / `tests/unified-grep.test.ts` already use.
 *
 * Acceptance target (P1 roadmap row, preserved in git history at
 * `82e895867c:apps/busabase/content/spec/drive-grep-retrieval.md`):
 *   "Warm grep of a 100 MB-text Space < 1 s"
 *
 * Usage:
 *   pnpm --filter busabase-core bench:grep
 *   BENCH_TOTAL_MB=200 BENCH_FILE_COUNT=40 pnpm --filter busabase-core bench:grep
 *   BENCH_FORCE_JS_SCANNER=1 pnpm --filter busabase-core bench:grep   # disable rg acceleration
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

const TOTAL_MB = Number(process.env.BENCH_TOTAL_MB ?? 100);
const FILE_COUNT = Number(process.env.BENCH_FILE_COUNT ?? 20);
const WARM_RUNS = Number(process.env.BENCH_WARM_RUNS ?? 5);
const TARGET_MS = Number(process.env.BENCH_TARGET_MS ?? 1000);
const FORCE_JS_SCANNER = process.env.BENCH_FORCE_JS_SCANNER === "1";

// `isRgAvailable()` detects the `rg` binary once per process and memoizes
// the result forever — must strip it from PATH before the engine's first
// grep call, not just before we print the "rg available" line.
if (FORCE_JS_SCANNER) {
  const sep = path.delimiter;
  process.env.PATH = (process.env.PATH ?? "")
    .split(sep)
    .filter((dir) => {
      try {
        return !existsSync(path.join(dir, "rg"));
      } catch {
        return true;
      }
    })
    .join(sep);
}

const BASE_WORDS =
  "agent workflow review database throughput latency index record merge pipeline search cursor pagination schema vector approval orchestration benchmark cluster endpoint ";
const NEEDLE = "UNIQUE_BENCHMARK_NEEDLE_9f3c1a";

/** Deterministic filler text of ~targetBytes, wrapped to realistic line lengths. */
function buildFillerText(targetBytes: number): string {
  const reps = Math.ceil(targetBytes / BASE_WORDS.length);
  const raw = BASE_WORDS.repeat(reps).slice(0, targetBytes);
  return raw.replace(/(.{120})/g, "$1\n");
}

interface ScenarioResult {
  label: string;
  coldMs: number;
  avgWarmMs: number;
  minWarmMs: number;
  maxWarmMs: number;
  matches: number;
}

async function main() {
  const originalCwd = process.cwd();
  process.chdir(MIGRATIONS_CWD);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bench-grep-db-"));
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bench-grep-storage-"));
  process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/bench/storage`;

  // Import after env vars are set — db/router modules read config lazily
  // on first use, but importing late keeps setup order obvious.
  const { busabaseRouter } = await import("../src/router");
  const { isRgAvailable } = await import("../src/domains/assets/logic/asset-grep-logic");
  type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  const client: Client = createRouterClient(busabaseRouter);

  try {
    const bytesPerFile = Math.floor((TOTAL_MB * 1024 * 1024) / FILE_COUNT);
    console.log(
      `Seeding ~${TOTAL_MB}MB across ${FILE_COUNT} files (~${(bytesPerFile / 1024 / 1024).toFixed(1)}MB each)...`,
    );
    const seedT0 = Date.now();
    for (let i = 0; i < FILE_COUNT; i++) {
      const fileName = `bench-${i}.txt`;
      const contentHash = HASH(String(i % 10));
      const uploadReq = await client.assets.createUploadUrl({
        fileName,
        mimeType: "text/plain",
        sizeBytes: 100,
        contentHash,
      });
      const confirmed = await client.assets.confirm({
        storageKey: uploadReq.storageKey,
        fileName,
        mimeType: "text/plain",
        sizeBytes: 100,
        contentHash,
      });
      const assetId = confirmed.assetId;
      if (!assetId) throw new Error(`confirm() did not return an assetId for ${fileName}`);

      let text = buildFillerText(bytesPerFile);
      if (i === FILE_COUNT - 1) {
        text += `\n${NEEDLE} marks the single expected hit\n`;
      }
      const bytes = Buffer.from(text, "utf8");

      const upload = await client.assets.createTextUploadUrl({ assetId, sizeBytes: bytes.length });
      await storage.uploadFileToKey(bytes, upload.storageKey, "text/plain");
      await client.assets.putText({ assetId, storageKey: upload.storageKey });
    }
    const seedMs = Date.now() - seedT0;
    console.log(`Seed done in ${(seedMs / 1000).toFixed(1)}s\n`);

    const rgAvailable = await isRgAvailable();
    console.log(
      `rg acceleration: ${rgAvailable ? "available (used for literal patterns, contextLines=0)" : "NOT available — JS scanner only"}`,
    );
    console.log(`grep concurrency: ${process.env.BUSABASE_GREP_CONCURRENCY ?? "4 (default)"}\n`);

    const scenarios: { label: string; pattern: string }[] = [
      { label: "common word (many hits, early-cutoff eligible)", pattern: "throughput" },
      { label: "rare needle (1 hit, forces a full tail scan)", pattern: NEEDLE },
      { label: "not-found (guaranteed full scan of every file)", pattern: "ZZZ_NEVER_MATCHES_ZZZ" },
    ];

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      let coldMs = 0;
      let lastMatches = 0;
      const warmTimings: number[] = [];
      for (let run = 0; run < WARM_RUNS + 1; run++) {
        const t0 = Date.now();
        const result = await client.grep({ pattern: scenario.pattern, maxMatches: 1000 });
        const elapsed = Date.now() - t0;
        lastMatches = result.matches.length;
        if (run === 0) {
          coldMs = elapsed;
          console.log(`  [cold] ${scenario.label}: ${elapsed}ms`);
        } else {
          warmTimings.push(elapsed);
        }
      }
      const avgWarmMs = warmTimings.reduce((a, b) => a + b, 0) / warmTimings.length;
      const minWarmMs = Math.min(...warmTimings);
      const maxWarmMs = Math.max(...warmTimings);
      console.log(
        `  [warm x${WARM_RUNS}] ${scenario.label}: avg=${avgWarmMs.toFixed(0)}ms min=${minWarmMs}ms max=${maxWarmMs}ms matches=${lastMatches}`,
      );
      results.push({
        label: scenario.label,
        coldMs,
        avgWarmMs,
        minWarmMs,
        maxWarmMs,
        matches: lastMatches,
      });
    }

    console.log(`\n=== SUMMARY (target: warm grep of ~${TOTAL_MB}MB < ${TARGET_MS}ms) ===`);
    console.table(
      results.map((r) => ({
        scenario: r.label,
        "cold ms": r.coldMs,
        "avg warm ms": Math.round(r.avgWarmMs),
        "min ms": r.minWarmMs,
        "max ms": r.maxWarmMs,
        matches: r.matches,
        "meets target": r.avgWarmMs < TARGET_MS ? "PASS" : "FAIL",
      })),
    );
  } finally {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
