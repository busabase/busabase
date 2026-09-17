import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createBusabaseORPCClient } from "busabase-contract/api-client";
import type { SearchResultVO } from "busabase-contract/types";
import type { RankedSearchResult, SearchQualityObservation } from "./search-quality-eval-lib.ts";
import searchQualityEvalLib from "./search-quality-eval-lib.ts";

const {
  buildSearchQualityCases,
  DEFAULT_SEARCH_QUALITY_OUTPUT,
  DEFAULT_SEARCH_QUALITY_SESSIONS,
  DEFAULT_SEARCH_QUALITY_URL,
  isLoopbackSearchEvalUrl,
  mergeQuickResults,
  rankOfTarget,
  summarizeSearchQuality,
} = searchQualityEvalLib;

const positiveInteger = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}`);
  }
  return parsed;
};

const baseUrl = (process.env.SEARCH_EVAL_URL ?? DEFAULT_SEARCH_QUALITY_URL).replace(/\/+$/, "");
const sessions = positiveInteger(process.env.SEARCH_EVAL_SESSIONS, DEFAULT_SEARCH_QUALITY_SESSIONS);
const outputPath = process.env.SEARCH_EVAL_OUTPUT ?? DEFAULT_SEARCH_QUALITY_OUTPUT;
if (!isLoopbackSearchEvalUrl(baseUrl) && process.env.SEARCH_EVAL_ALLOW_REMOTE !== "1") {
  throw new Error(
    "Search quality evaluation is local-only by default. Set SEARCH_EVAL_ALLOW_REMOTE=1 to acknowledge remote traffic and telemetry impact.",
  );
}
const cases = buildSearchQualityCases();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
let httpRequests = 0;
let searchMetricsRequests = 0;

const client = createBusabaseORPCClient(`${baseUrl}/api/rpc`, {
  fetch: async (request, init) => {
    httpRequests += 1;
    if (request.url.includes("/searchMetrics/report")) searchMetricsRequests += 1;
    return fetch(request, init);
  },
});

const timed = async <T,>(operation: () => Promise<T>) => {
  const startedAt = performance.now();
  const value = await operation();
  return { value, latencyMs: performance.now() - startedAt };
};

const quickSearch = async (query: string) => {
  const input = (source: "records" | "files" | "nodes" | "names") => ({
    query,
    limit: 6,
    mode: "quick" as const,
    surface: "quick" as const,
    offset: 0,
    sources: [source] as [typeof source],
  });
  const [nodeNames, records, files, nodes, names] = await Promise.all([
    client.nodes.searchByName({ query, limit: 20 }),
    client.search(input("records")),
    client.search(input("files")),
    client.search(input("nodes")),
    client.search(input("names")),
  ]);
  const mappedNodeNames: RankedSearchResult[] = nodeNames.map((result) => ({
    href: result.path,
    kind: "node-name",
    title: result.name,
  }));
  return mergeQuickResults({
    nodeNames: mappedNodeNames,
    records: records.results,
    files: files.results,
    nodes: nodes.results,
    names: names.results,
  });
};

const fullSearch = async (query: string): Promise<SearchResultVO[]> =>
  (
    await client.search({
      query,
      mode: "full",
      surface: "advanced",
      limit: 100,
      offset: 0,
    })
  ).results;

const health = await fetch(`${baseUrl}/api/health`).catch(() => null);
if (!health?.ok) {
  throw new Error(`Busabase server is not ready at ${baseUrl}; start the real local server first`);
}

const observations: SearchQualityObservation[] = [];
for (let index = 0; index < sessions; index += 1) {
  const searchCase = cases[index % cases.length];
  if (!searchCase) throw new Error(`No search case for session ${index + 1}`);

  const quick = await timed(() => quickSearch(searchCase.query));
  const quickRank = rankOfTarget(quick.value, searchCase.target.href);
  let advancedLatencyMs: number | null = null;
  let advancedRank: number | null = null;
  let advancedResultCount: number | null = null;
  if (quickRank === null) {
    const advanced = await timed(() => fullSearch(searchCase.query));
    advancedLatencyMs = advanced.latencyMs;
    advancedRank = rankOfTarget(
      advanced.value.map((result) => ({
        href: result.href,
        kind: result.kind,
        title: result.title,
      })),
      searchCase.target.href,
    );
    advancedResultCount = advanced.value.length;
  }

  observations.push({
    caseId: searchCase.id,
    quickLatencyMs: quick.latencyMs,
    quickRank,
    quickResultCount: quick.value.length,
    advancedLatencyMs,
    advancedRank,
    advancedResultCount,
  });

  if ((index + 1) % 50 === 0 || index + 1 === sessions) {
    process.stderr.write(`search quality: ${index + 1}/${sessions} sessions\n`);
  }
}

if (searchMetricsRequests !== 0) {
  throw new Error(
    `Offline evaluator unexpectedly sent ${searchMetricsRequests} search metric calls`,
  );
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evaluation: {
    kind: "synthetic-offline-search-quality-eval",
    commit,
    baseUrl,
    sessions,
    cases: cases.length,
    execution: "sequential sessions; five concurrent quick-search RPCs per session",
    seedGroundTruth: "buildDemoDataset('1') / English default seed",
    targetIsLoopback: isLoopbackSearchEvalUrl(baseUrl),
    searchInteractionMetricsEmitted: false,
    caveats: [
      "This is a deterministic seeded-corpus regression evaluation, not observed user behavior.",
      "No searchMetrics interaction is sent. The CLI defaults to loopback because search requests still produce ordinary request-level telemetry.",
      "No-click is a proxy: the expected target is outside quick rank 6 and advanced rank 20 (or absent), not an actual click event.",
      "Quick search includes authoritative node-name results but not the browser-local Recently visited cache, so coverage is conservative for previously visited targets.",
    ],
  },
  corpus: {
    categories: Object.fromEntries(
      ["record", "base", "doc", "file-content"].map((category) => [
        category,
        cases.filter((searchCase) => searchCase.category === category).length,
      ]),
    ),
    cases,
  },
  metrics: summarizeSearchQuality(observations, cases),
  transport: { httpRequests, searchMetricsRequests },
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(`search quality report written to ${outputPath}\n`);
