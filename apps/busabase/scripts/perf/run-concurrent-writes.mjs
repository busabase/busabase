// Concurrency test for the write path: N workers each loop
// create-change-request -> review -> merge against the SAME base, for a fixed
// duration. Measures whether merge throughput degrades or errors appear
// under concurrent writers (lock contention / races) — autocannon can't
// express this multi-step, unique-per-iteration flow, so it's a small
// hand-rolled harness instead.
//
// Usage:
//   DURATION=10 WORKERS=10 pnpm perf:writes
const BASE_URL = process.env.BUSABASE_URL ?? "http://localhost:15419";
const DURATION_MS = Number(process.env.DURATION ?? 10) * 1000;
const WORKERS = Number(process.env.WORKERS ?? 10);

async function api(method, path, body) {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ms = Date.now() - t0;
  const ok = res.ok;
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  return { ok, status: res.status, ms, json };
}

async function worker(id, blogId, stats, deadline) {
  let n = 0;
  while (Date.now() < deadline) {
    const cycleStart = Date.now();
    const create = await api("POST", `/bases/${blogId}/change-requests`, {
      fields: {
        title: `Concurrent write ${id}-${n}`,
        body: "concurrency probe",
        channel: "blog",
        priority: n % 100,
      },
      message: `worker ${id} iteration ${n}`,
      submittedBy: `perf-worker-${id}`,
    });
    if (!create.ok) {
      stats.errors.push({ stage: "create", status: create.status, body: create.json });
      continue;
    }
    const crId = create.json.id;
    const review = await api("POST", `/change-requests/${crId}/reviews`, { verdict: "approved" });
    if (!review.ok) {
      stats.errors.push({ stage: "review", status: review.status, body: review.json });
      continue;
    }
    const merge = await api("POST", `/change-requests/${crId}/merge`, {});
    if (!merge.ok) {
      stats.errors.push({ stage: "merge", status: merge.status, body: merge.json });
      continue;
    }
    stats.cycleLatencies.push(Date.now() - cycleStart);
    stats.completed++;
    n++;
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const res = await fetch(`${BASE_URL}/api/v1/bases`);
  const bases = await res.json();
  const blog = bases.find((b) => b.slug === "blog");
  if (!blog) throw new Error("blog base not found — run `pnpm demo` first");

  console.log(
    `Concurrent write test: ${WORKERS} workers, ${DURATION_MS / 1000}s, base=${blog.slug}`,
  );
  const stats = { completed: 0, errors: [], cycleLatencies: [] };
  const deadline = Date.now() + DURATION_MS;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i, blog.id, stats, deadline)));
  const elapsed = (Date.now() - t0) / 1000;

  console.log(
    `\nCompleted ${stats.completed} full create→review→merge cycles in ${elapsed.toFixed(1)}s`,
  );
  console.log(`Throughput: ${(stats.completed / elapsed).toFixed(2)} cycles/sec`);
  console.log(
    `Cycle latency: p50=${percentile(stats.cycleLatencies, 50)}ms p90=${percentile(stats.cycleLatencies, 90)}ms p99=${percentile(stats.cycleLatencies, 99)}ms max=${Math.max(0, ...stats.cycleLatencies)}ms`,
  );
  console.log(`Errors: ${stats.errors.length}`);
  if (stats.errors.length > 0) {
    console.log("Sample errors:", JSON.stringify(stats.errors.slice(0, 5), null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
