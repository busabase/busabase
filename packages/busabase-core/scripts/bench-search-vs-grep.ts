/**
 * search() vs grep() performance comparison.
 *
 * Companion to `bench-grep.ts` — that script validates grep's own P1
 * acceptance criterion in isolation; this one answers the followup
 * question of *why* `search` and `grep` (Unified Grep P2b) exist as two
 * separate tools instead of one: `search` matches against a SQL-indexed
 * (tsvector + pg_trgm GIN) projection of record field values
 * (`busabase_field_values.valueText`, capped at `VALUE_TEXT_INDEX_LIMIT`
 * chars), while `grep`'s records adapter reads canonical
 * `busabase_commits.fields` directly with a full in-process regex scan —
 * no index, no cap. The architectural expectation is: search should win on
 * records as record count grows (index lookup vs. full scan), the two
 * should be roughly comparable on files (both stream-scan storage since the
 * P1 search-convergence work put them on the same mechanism), and search
 * can't see Doc bodies at all. This script measures the first two
 * empirically instead of leaving them as an assumption.
 *
 * Same harness as `bench-grep.ts` and `tests/drive-grep-*.test.ts` — real
 * PGLite DB + local filesystem storage, driven through the real oRPC router.
 *
 * Usage:
 *   pnpm --filter busabase-core bench:search-vs-grep
 *   BENCH_RECORD_COUNT=8000 pnpm --filter busabase-core bench:search-vs-grep
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

const RECORD_COUNT = Number(process.env.BENCH_RECORD_COUNT ?? 4000);
const FILE_TOTAL_MB = Number(process.env.BENCH_FILE_TOTAL_MB ?? 100);
const FILE_COUNT = Number(process.env.BENCH_FILE_COUNT ?? 20);
const WARM_RUNS = Number(process.env.BENCH_WARM_RUNS ?? 5);

const BASE_WORDS =
  "agent workflow review database throughput latency index record merge pipeline search cursor pagination schema vector approval orchestration benchmark cluster endpoint ";
const RECORD_NEEDLE = "UNIQUE_RECORD_NEEDLE_7c2f9b";
const FILE_NEEDLE = "UNIQUE_FILE_NEEDLE_9f3c1a";

function buildFillerText(targetBytes: number): string {
  const reps = Math.ceil(targetBytes / BASE_WORDS.length);
  const raw = BASE_WORDS.repeat(reps).slice(0, targetBytes);
  return raw.replace(/(.{120})/g, "$1\n");
}

interface TimingRow {
  label: string;
  coldMs: number;
  avgWarmMs: number;
  minWarmMs: number;
  maxWarmMs: number;
  hits: number;
}

async function timeRepeated<T>(
  label: string,
  runs: number,
  call: () => Promise<T>,
  countHits: (result: T) => number,
): Promise<TimingRow> {
  let coldMs = 0;
  let hits = 0;
  const warmTimings: number[] = [];
  for (let run = 0; run < runs + 1; run++) {
    const t0 = Date.now();
    const result = await call();
    const elapsed = Date.now() - t0;
    hits = countHits(result);
    if (run === 0) {
      coldMs = elapsed;
    } else {
      warmTimings.push(elapsed);
    }
  }
  const avgWarmMs = warmTimings.reduce((a, b) => a + b, 0) / warmTimings.length;
  return {
    label,
    coldMs,
    avgWarmMs,
    minWarmMs: Math.min(...warmTimings),
    maxWarmMs: Math.max(...warmTimings),
    hits,
  };
}

function printTable(title: string, rows: TimingRow[]) {
  console.log(`\n=== ${title} ===`);
  console.table(
    rows.map((r) => ({
      scenario: r.label,
      "cold ms": r.coldMs,
      "avg warm ms": Math.round(r.avgWarmMs),
      "min ms": r.minWarmMs,
      "max ms": r.maxWarmMs,
      hits: r.hits,
    })),
  );
}

async function main() {
  const originalCwd = process.cwd();
  process.chdir(MIGRATIONS_CWD);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bench-svg-db-"));
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bench-svg-storage-"));
  process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/bench/storage`;

  const { busabaseRouter } = await import("../src/router");
  type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  const client: Client = createRouterClient(busabaseRouter);

  try {
    // ── Records comparison — the scenario where search's SQL index should
    // matter most: does search stay flat-ish as record count grows while
    // grep's full canonical scan grows with it? ─────────────────────────
    console.log(`Seeding ${RECORD_COUNT} records (1 Base, longtext field)...`);
    const recordSeedT0 = Date.now();
    const base = await client.bases.create({
      slug: "bench-records",
      name: "Bench Records",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "notes", name: "Notes", type: "longtext" },
      ],
      autoMerge: true,
    });
    if (!("id" in base)) throw new Error("Expected a materialized BaseVO (autoMerge: true)");

    const BATCH = 1000;
    let created = 0;
    let needlePlaced = false;
    for (let start = 0; start < RECORD_COUNT; start += BATCH) {
      const count = Math.min(BATCH, RECORD_COUNT - start);
      const records = Array.from({ length: count }, (_, i) => {
        const idx = start + i;
        const isLast = idx === RECORD_COUNT - 1;
        let notes = buildFillerText(2000);
        if (isLast) {
          notes = `${notes}\n${RECORD_NEEDLE} marks the single expected hit\n`;
          needlePlaced = true;
        }
        return { title: `Bench record #${idx}`, notes };
      });
      const cr = await client.bases.createBulkChangeRequest({
        baseId: base.id,
        records,
        message: `Bench seed batch ${start}-${start + count}`,
        submittedBy: "bench-script",
      });
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: cr.id });
      created += count;
    }
    if (!needlePlaced) throw new Error("Needle record was never seeded");
    console.log(
      `Seeded ${created} records in ${((Date.now() - recordSeedT0) / 1000).toFixed(1)}s\n`,
    );

    const recordRows: TimingRow[] = [];
    recordRows.push(
      await timeRepeated(
        "search: common word (many hits)",
        WARM_RUNS,
        () => client.search({ query: "throughput", limit: 20 }),
        (r) => r.results.length,
      ),
    );
    recordRows.push(
      await timeRepeated(
        "grep(records): common word (many hits)",
        WARM_RUNS,
        () => client.grep({ pattern: "throughput", sources: ["records"], maxMatches: 1000 }),
        (r) => r.matches.length,
      ),
    );
    recordRows.push(
      await timeRepeated(
        "search: needle past 8000-char truncation (expected MISS)",
        WARM_RUNS,
        () => client.search({ query: RECORD_NEEDLE, limit: 20 }),
        (r) => r.results.length,
      ),
    );
    recordRows.push(
      await timeRepeated(
        "grep(records): same needle (expected 1 HIT — untruncated canonical read)",
        WARM_RUNS,
        () => client.grep({ pattern: RECORD_NEEDLE, sources: ["records"], maxMatches: 1000 }),
        (r) => r.matches.length,
      ),
    );
    printTable(`RECORDS — search vs grep, ${created} records`, recordRows);

    // ── Files comparison — runs in the SAME space as the records seeded
    // above, on purpose: `search()` has no `sources`/scope parameter, so
    // every call always pays its records-ranking query cost regardless of
    // what content type the caller actually cares about. A "files" search
    // in a space that also has records is the realistic case — an empty-
    // of-records space is the artificial one. Files are also explicitly
    // MOUNTED into Drive (a file-type node per asset) below: `search`'s
    // file path requires a `busabaseAssetUsages` row to consider an asset a
    // candidate at all, while `grep`'s file adapter queries assets
    // directly with no such requirement — an unmounted asset is invisible
    // to search regardless of speed, which would make "search never finds
    // it" look like a fidelity gap when it's actually just an unrealistic
    // fixture (real files are basically always mounted somewhere). ────────
    const bytesPerFile = Math.floor((FILE_TOTAL_MB * 1024 * 1024) / FILE_COUNT);
    console.log(`Seeding ~${FILE_TOTAL_MB}MB across ${FILE_COUNT} files...`);
    const fileSeedT0 = Date.now();
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
        text += `\n${FILE_NEEDLE} marks the single expected hit\n`;
      }
      const bytes = Buffer.from(text, "utf8");
      const upload = await client.assets.createTextUploadUrl({ assetId, sizeBytes: bytes.length });
      await storage.uploadFileToKey(bytes, upload.storageKey, "text/plain");
      await client.assets.putText({ assetId, storageKey: upload.storageKey });

      // `search`'s file path requires a `busabaseAssetUsages` row (an asset
      // must be MOUNTED somewhere — Drive path, record field, etc.) to be a
      // candidate at all; `grep`'s file adapter has no such requirement, it
      // queries assets directly. An unmounted asset is invisible to search
      // regardless of speed — mount every file into Drive so this is an
      // honest apples-to-apples comparison, not "grep finds it, search was
      // structurally blind to it before either tool did any work."
      await client.nodes.createChangeRequest({
        message: `Mount ${fileName}`,
        operations: [
          {
            kind: "create",
            nodeType: "file",
            slug: `bench-file-${i}`,
            name: fileName,
            metadata: { assetId },
          },
        ],
        autoMerge: true,
      });
    }
    console.log(`Seed done in ${((Date.now() - fileSeedT0) / 1000).toFixed(1)}s\n`);

    const fileRows: TimingRow[] = [];
    fileRows.push(
      await timeRepeated(
        "search: common word in files (many hits)",
        WARM_RUNS,
        () => client.search({ query: "throughput", limit: 20 }),
        (r) => r.results.length,
      ),
    );
    fileRows.push(
      await timeRepeated(
        "grep(files): common word in files (many hits)",
        WARM_RUNS,
        () => client.grep({ pattern: "throughput", sources: ["files"], maxMatches: 1000 }),
        (r) => r.matches.length,
      ),
    );
    fileRows.push(
      await timeRepeated(
        "search: rare needle (1 file, full tail scan)",
        WARM_RUNS,
        () => client.search({ query: FILE_NEEDLE, limit: 20 }),
        (r) => r.results.length,
      ),
    );
    fileRows.push(
      await timeRepeated(
        "grep(files): same rare needle",
        WARM_RUNS,
        () => client.grep({ pattern: FILE_NEEDLE, sources: ["files"], maxMatches: 1000 }),
        (r) => r.matches.length,
      ),
    );
    printTable(`FILES — search vs grep, ~${FILE_TOTAL_MB}MB / ${FILE_COUNT} files`, fileRows);

    console.log(
      "\nNote: `search`'s record path also carries an in-memory `throughput` case above that " +
        "returns whatever the truncated search results shape naturally caps at, not a maxMatches " +
        'parameter — the two tools\' "many hits" numbers are not apples-to-apples on result count, ' +
        "only on latency.",
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
