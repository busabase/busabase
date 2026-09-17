import { describe, expect, it } from "vitest";
import {
  buildSearchQualityCases,
  isLoopbackSearchEvalUrl,
  mergeQuickResults,
  percentile,
  type RankedSearchResult,
  rankOfTarget,
  type SearchQualityObservation,
  summarizeSearchQuality,
} from "../scripts/perf/search-quality-eval-lib";

const result = (href: string, kind: "record" | "change_request" | "base" | "file" | "node") => ({
  id: href,
  kind,
  title: href,
  body: "",
  eyebrow: "",
  href,
  updatedAt: null,
  createdBy: null,
});

describe("search quality corpus", () => {
  it("builds 20 deterministic, balanced cases from the English seed ground truth", () => {
    const first = buildSearchQualityCases();
    const second = buildSearchQualityCases();
    expect(second).toEqual(first);
    expect(first).toHaveLength(20);
    expect(new Set(first.map((searchCase) => searchCase.id)).size).toBe(20);
    expect(
      Object.fromEntries(
        ["record", "base", "doc", "file-content"].map((category) => [
          category,
          first.filter((searchCase) => searchCase.category === category).length,
        ]),
      ),
    ).toEqual({ record: 5, base: 5, doc: 5, "file-content": 5 });
  });
});

describe("search quality target safety", () => {
  it("allows loopback servers and rejects remote targets by default", () => {
    expect(isLoopbackSearchEvalUrl("http://localhost:15419")).toBe(true);
    expect(isLoopbackSearchEvalUrl("http://127.0.0.1:15419")).toBe(true);
    expect(isLoopbackSearchEvalUrl("http://[::1]:15419")).toBe(true);
    expect(isLoopbackSearchEvalUrl("https://busabase.com")).toBe(false);
  });
});

describe("quick-search simulation", () => {
  it("uses dialog section order, removes a duplicate base, and truncates to six", () => {
    const nodeNames: RankedSearchResult[] = [
      { href: "/base/alpha", kind: "node-name", title: "Alpha" },
    ];
    const merged = mergeQuickResults({
      nodeNames,
      records: [result("/record/1", "record"), result("/cr/1", "change_request")],
      files: [result("/file/1", "file"), result("/file/2", "file")],
      nodes: [result("/doc/1", "node"), result("/doc/2", "node")],
      names: [result("/base/alpha", "base"), result("/base/beta", "base")],
    });

    expect(merged.map((item) => item.href)).toEqual([
      "/base/alpha",
      "/record/1",
      "/file/1",
      "/file/2",
      "/doc/1",
      "/doc/2",
    ]);
    expect(rankOfTarget(merged, "/record/1")).toBe(2);
    expect(rankOfTarget(merged, "/base/beta")).toBeNull();
  });
});

describe("search quality metrics", () => {
  it("uses nearest-rank percentiles and explicit proxy denominators", () => {
    expect(percentile([1, 2, 3, 100], 50)).toBe(2);
    expect(percentile([1, 2, 3, 100], 95)).toBe(100);
    expect(percentile([], 95)).toBeNull();

    const cases = buildSearchQualityCases().slice(0, 2);
    const observations: SearchQualityObservation[] = [
      {
        caseId: cases[0]?.id ?? "missing-1",
        quickLatencyMs: 10,
        quickRank: 1,
        quickResultCount: 6,
        advancedLatencyMs: null,
        advancedRank: null,
        advancedResultCount: null,
      },
      {
        caseId: cases[1]?.id ?? "missing-2",
        quickLatencyMs: 20,
        quickRank: null,
        quickResultCount: 0,
        advancedLatencyMs: 30,
        advancedRank: 21,
        advancedResultCount: 40,
      },
    ];
    const summary = summarizeSearchQuality(observations, cases);

    expect(summary.quickCoverageRate).toEqual({ count: 1, denominator: 2, rate: 0.5 });
    expect(summary.escalationRate).toEqual({ count: 1, denominator: 2, rate: 0.5 });
    expect(summary.targetAbsentRate.rate).toBe(0);
    expect(summary.noClickProxyRate.rate).toBe(0.5);
    expect(summary.validQueryFalseZeroRate.rate).toBe(0);
    expect(summary.latencyMs.quick).toEqual({ samples: 2, p50: 10, p95: 20 });
  });
});
