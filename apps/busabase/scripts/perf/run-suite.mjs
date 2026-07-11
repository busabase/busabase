// Sequential autocannon suite against a running busabase server. Each
// scenario runs alone (not overlapped) so throughput numbers aren't muddied
// by cross-scenario contention — this isolates which endpoint is slow.
//
// Usage:
//   pnpm start                                # server must already be running
//   pnpm demo                                 # and seeded (bases, records, ...)
//   DURATION=8 CONNECTIONS=20 pnpm perf:suite  # then run this
import autocannon from "autocannon";

const BASE_URL = process.env.BUSABASE_URL ?? "http://localhost:15419";
const DURATION = Number(process.env.DURATION ?? 10); // seconds per scenario
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 20);

async function getBlogBaseId() {
  const res = await fetch(`${BASE_URL}/api/v1/bases`);
  const bases = await res.json();
  const blog = bases.find((b) => b.slug === "blog");
  if (!blog) throw new Error("blog base not found — run `pnpm demo` first");
  return blog.id;
}

function run(opts) {
  return new Promise((resolve, reject) => {
    autocannon(
      { url: BASE_URL, connections: CONNECTIONS, duration: DURATION, ...opts },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      },
    );
  });
}

function summarize(label, result) {
  const { latency, requests, throughput, errors, timeouts, non2xx } = result;
  return {
    label,
    reqPerSec: requests.average,
    totalRequests: requests.total,
    latencyP50: latency.p50,
    latencyP97_5: latency.p97_5,
    latencyP99: latency.p99,
    latencyMax: latency.max,
    throughputAvgKB: Math.round(throughput.average / 1024),
    errors,
    timeouts,
    non2xx,
  };
}

async function main() {
  const blogId = await getBlogBaseId();
  console.log(
    `Using blog base ${blogId}, ${CONNECTIONS} connections x ${DURATION}s per scenario\n`,
  );

  const scenarios = [
    { label: "GET /bases (list all bases)", path: "/api/v1/bases" },
    {
      label: "GET /records/paged (first page, no filter)",
      path: `/api/v1/records/paged?baseId=${blogId}&limit=25`,
    },
    {
      label: "GET /records/paged (sorted by priority, keyset join path)",
      path: `/api/v1/records/paged?baseId=${blogId}&limit=25&sort[fieldSlug]=priority&sort[fieldType]=number&sort[direction]=desc`,
    },
    {
      label: "GET /records/paged (server-side filter push-down: channel contains 'blog')",
      path: `/api/v1/records/paged?baseId=${blogId}&limit=25&filters[0][fieldSlug]=channel&filters[0][fieldType]=text&filters[0][operator]=contains&filters[0][value]=blog`,
    },
    { label: "GET /records/count", path: `/api/v1/records/count?baseId=${blogId}` },
    {
      label: "GET /search?query=Kelly (global search, selective/realistic hit)",
      path: "/api/v1/search?query=Kelly",
    },
    {
      label: "GET /search?query=zzzznotfound (global search, no-hit query)",
      path: "/api/v1/search?query=zzzznotfound",
    },
    { label: "GET /change-requests/paged", path: "/api/v1/change-requests/paged?limit=25" },
  ];

  const results = [];
  for (const scenario of scenarios) {
    process.stdout.write(`Running: ${scenario.label} ... `);
    const result = await run({ url: `${BASE_URL}${scenario.path}`, method: "GET" });
    const summary = summarize(scenario.label, result);
    results.push(summary);
    console.log(
      `${summary.reqPerSec} req/s, p50=${summary.latencyP50}ms p99=${summary.latencyP99}ms`,
    );
  }

  console.log("\n=== SUMMARY ===");
  console.table(
    results.map((r) => ({
      scenario: r.label,
      "req/s": r.reqPerSec,
      total: r.totalRequests,
      "p50 ms": r.latencyP50,
      "p97.5 ms": r.latencyP97_5,
      "p99 ms": r.latencyP99,
      "max ms": r.latencyMax,
      "KB/s": r.throughputAvgKB,
      errors: r.errors,
      non2xx: r.non2xx,
    })),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
