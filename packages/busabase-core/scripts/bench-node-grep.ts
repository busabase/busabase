/**
 * Node-content grep concurrency benchmark.
 *
 * Measures what the node adapter's batch pool actually buys, against a REMOTE
 * storage provider — the only place it can matter, since each candidate costs
 * a storage round trip and the pre-pool adapter awaited them one at a time.
 * A local-provider run would measure disk reads and show nothing.
 *
 * `BUSABASE_GREP_CONCURRENCY=1` IS the old sequential behaviour, so one build
 * measures both sides: the script runs the same grep at concurrency 1 and at
 * the default 4 and prints the ratio.
 *
 * Two regimes, both real:
 *   COLD — cache cleared first, so every node is downloaded.
 *   WARM — entries cached, so each node costs only its body-free
 *          `getObjectMetadata` validation probe.
 *
 * Requires a reachable S3-compatible endpoint. Defaults to the repo's local
 * MinIO from `docker-compose.yml` (`make db`).
 *
 * Usage:
 *   pnpm --filter busabase-core bench:node-grep
 *   BENCH_NODE_COUNT=50 pnpm --filter busabase-core bench:node-grep
 *   BENCH_STORAGE_URL=s3://key:secret@s3.amazonaws.com/bucket pnpm --filter busabase-core bench:node-grep
 */
import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouterClient } from "@orpc/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const NODE_COUNT = Number(process.env.BENCH_NODE_COUNT ?? 20);
const BODY_LINES = Number(process.env.BENCH_BODY_LINES ?? 1000);
const CONCURRENCIES = (process.env.BENCH_CONCURRENCIES ?? "1,4").split(",");
const STORAGE_URL =
  process.env.BENCH_STORAGE_URL ??
  `minio://bika:bikabika@127.0.0.1:9000/grepbench-${process.pid}?ssl=false&auto_create=true`;

// A pattern that matches NOTHING, so every node is fully scanned in every run
// and no `maxMatches` early-exit skews the comparison.
const PATTERN = "ZZZ_NO_SUCH_NEEDLE_ZZZ";
// The cache only accepts an entry once its 1-second `lastModified` bucket is
// provably closed; seeded content must clear that window before the WARM run.
const SETTLE_MS = 2_600;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "bench-node-grep-db-"));
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "bench-node-grep-cache-"));
  process.chdir(MIGRATIONS_CWD);
  process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  process.env.STORAGE_URL = STORAGE_URL;
  process.env.BUSABASE_GREP_CACHE_DIR = cacheDir;
  process.env.BUSABASE_GREP_TIMEOUT_MS = "600000"; // never truncate mid-benchmark

  const { busabaseRouter } = await import("../src/router");
  const client = createRouterClient(busabaseRouter);

  const body = `${"lorem ipsum dolor sit amet consectetur\n".repeat(BODY_LINES)}`;
  const bodyKb = Math.round(Buffer.byteLength(body, "utf8") / 1024);
  console.log(
    `Seeding ${NODE_COUNT} Doc nodes (~${bodyKb} KB each) into ${STORAGE_URL.split("@")[1]}`,
  );
  for (let i = 0; i < NODE_COUNT; i++) {
    await client.docs.create({ autoMerge: true, slug: `bench-${i}`, name: `Bench ${i}`, body });
  }
  await sleep(SETTLE_MS);

  const clearCache = async () => {
    for (const name of await readdir(cacheDir).catch(() => [] as string[])) {
      await unlink(path.join(cacheDir, name)).catch(() => {});
    }
  };

  const timed = async (label: string) => {
    const started = performance.now();
    const result = await client.grep({ pattern: PATTERN, sources: ["nodes"] });
    const ms = performance.now() - started;
    if (result.coverage.nodes.scanned !== NODE_COUNT) {
      throw new Error(
        `benchmark invalid: scanned ${result.coverage.nodes.scanned}/${NODE_COUNT} — a truncated run is not comparable`,
      );
    }
    console.log(`  ${label.padEnd(34)} ${ms.toFixed(0).padStart(6)} ms`);
    return ms;
  };

  const results: Record<string, { cold: number; warm: number }> = {};
  for (const concurrency of CONCURRENCIES) {
    process.env.BUSABASE_GREP_CONCURRENCY = concurrency;
    console.log(
      `\nBUSABASE_GREP_CONCURRENCY=${concurrency}${concurrency === "1" ? "  (= pre-pool sequential behaviour)" : ""}`,
    );
    await clearCache();
    const cold = await timed("COLD (downloads every node)");
    const warm = await timed("WARM (metadata probe per node)");
    results[concurrency] = { cold, warm };
  }

  const [baseline, ...rest] = CONCURRENCIES;
  const base = results[baseline];
  console.log(`\nSpeedup vs concurrency=${baseline}:`);
  for (const concurrency of rest) {
    const r = results[concurrency];
    console.log(
      `  concurrency=${concurrency}  COLD ${(base.cold / r.cold).toFixed(2)}x   WARM ${(base.warm / r.warm).toFixed(2)}x`,
    );
  }
  console.log(
    "\nNote: against a LOCAL MinIO the per-request RTT is ~0, so these ratios are a\n" +
      "conservative floor. The pool's whole job is hiding round-trip latency, so a\n" +
      "genuinely remote S3/R2 endpoint (tens of ms RTT) widens the gap, not narrows it.",
  );

  for (const dir of [dataDir, cacheDir]) await rm(dir, { recursive: true, force: true });
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
