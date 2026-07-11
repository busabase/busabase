// Bulk-seeds the `blog` demo base with N synthetic records via the real
// bulk-change-request + review + merge API path (the same path a real
// importer/agent would use), so perf tests exercise realistic write and
// merge behavior instead of a hand-inserted fixture.
//
// Usage:
//   pnpm demo                       # first: seed the base dataset (bases, records, ...)
//   SEED_TOTAL=8000 pnpm perf:seed  # then: bulk-add N more records to `blog`
const BASE_URL = process.env.BUSABASE_URL ?? "http://localhost:15419";
const TOTAL = Number(process.env.SEED_TOTAL ?? 8000);
const BATCH = 1000; // API cap per bulk change request (createBulkChangeRequestInputSchema)

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const CHANNELS = ["blog", "changelog", "guide", "announcement"];
// Must match the seeded blog base's `status` select field choice ids
// (see busabase-core/demo/dataset.ts) — not arbitrary labels.
const STATUSES = ["idea", "drafting", "published"];
const WORDS = [
  "agent",
  "workflow",
  "review",
  "database",
  "throughput",
  "latency",
  "index",
  "record",
  "merge",
  "pipeline",
  "search",
  "cursor",
  "pagination",
  "schema",
  "vector",
  "approval",
  "orchestration",
  "benchmark",
  "cluster",
  "endpoint",
];

function randomBody(seed) {
  const words = [];
  for (let i = 0; i < 120; i++) {
    words.push(WORDS[(seed + i * 7) % WORDS.length]);
  }
  return words.join(" ");
}

function makeRecord(i) {
  return {
    title: `Perf record #${i} ${WORDS[i % WORDS.length]}`,
    body: randomBody(i),
    channel: CHANNELS[i % CHANNELS.length],
    priority: i % 100,
    ready: i % 3 === 0,
    status: STATUSES[i % STATUSES.length],
  };
}

async function main() {
  const bases = await api("GET", "/bases");
  const blog = bases.find((b) => b.slug === "blog");
  if (!blog) throw new Error("blog base not found — run `pnpm demo` first");

  console.log(`Seeding ${TOTAL} records into base "${blog.slug}" (${blog.id})`);
  let created = 0;
  const t0 = Date.now();
  for (let start = 0; start < TOTAL; start += BATCH) {
    const count = Math.min(BATCH, TOTAL - start);
    const records = Array.from({ length: count }, (_, i) => makeRecord(start + i));
    const cr = await api("POST", `/bases/${blog.id}/records/bulk-change-request`, {
      records,
      message: `Perf seed batch ${start}-${start + count}`,
      submittedBy: "perf-seed-script",
    });
    await api("POST", `/change-requests/${cr.id}/reviews`, { verdict: "approved" });
    await api("POST", `/change-requests/${cr.id}/merge`, {});
    created += count;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `  merged batch ${start}-${start + count} (${created}/${TOTAL}) — ${elapsed}s elapsed`,
    );
  }
  console.log(`Done. Seeded ${created} records in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
