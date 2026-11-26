import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { createBusabaseCms } from "../src/content";
import type { BusabaseCmsRecord, BusabaseCmsSource } from "../src/source";
import {
  measureSummaryCacheEntryBytes,
  SUMMARY_CACHE_BUDGET_BYTES,
  warnOnSummaryCacheBudget,
} from "../src/summary-cache-budget";

const records = (kind: "posts" | "pages", count: number): BusabaseCmsRecord[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${kind}-${index}`,
    status: "active",
    updatedAt: "2026-11-26T00:00:00.000Z",
    headCommit: {
      payload: {
        path: `/${kind === "posts" ? "blog" : "use-cases"}/growth-${index}`,
        slug: `growth-${index}`,
        title: `Growth-sized CMS index ${index} 中文`,
        description: "Practical workflow guidance for a growing multilingual content catalog.",
        locale: index % 2 ? "en" : "zh-CN",
        status: "published",
        body: "Large rendered article body must stay outside summary caches. ".repeat(300),
        "seo-title": `Content catalog growth ${index}`,
        "seo-description": "A useful description with source-specific metadata.",
        "published-at": "2026-11-25T12:00:00.000Z",
        keywords: '["agents","workflows","中文"]',
        "meta-description": "Legacy description kept for the Buda adapter.",
        "source-path": `legacy/growth-${index}`,
        ...(kind === "pages"
          ? { hero: { headline: "Page hero" }, features: [{ title: "Feature" }], faqs: [] }
          : { attachments: [], tags: ["workflow"], author: "Busabase" }),
      },
    },
  }));

const paginatedSource = (items: BusabaseCmsRecord[]): BusabaseCmsSource => ({
  getBaseBySlug: async (slug) => ({ id: slug, slug }),
  listRecordsPage: async ({ cursor, limit }) => {
    const offset = Number(cursor ?? 0);
    const end = offset + limit;
    return {
      records: items.slice(offset, end),
      nextCursor: end < items.length ? String(end) : null,
    };
  },
});

describe("summary cache serialization budget", () => {
  it.each([
    ["posts", 1500],
    ["pages", 1000],
  ] as const)("keeps a growth-sized %s catalog below 1.9 MiB", async (kind, count) => {
    const cms = createBusabaseCms({ source: paginatedSource(records(kind, count)) });
    const summaries = await cms[kind].listSummaries();
    expect(summaries).toHaveLength(count);
    const size = measureSummaryCacheEntryBytes(summaries);
    expect(size, `${count} ${kind}: ${size} serialized bytes`).toBeLessThan(
      SUMMARY_CACHE_BUDGET_BYTES,
    );
    expect(summaries[0].rawFields).toMatchObject({
      keywords: '["agents","workflows","中文"]',
      "meta-description": "Legacy description kept for the Buda adapter.",
      "source-path": "legacy/growth-0",
    });
    // Prove the budget catches a body accidentally leaking back into a cached summary.
    expect(
      measureSummaryCacheEntryBytes([
        ...summaries,
        { rawFields: { body: "x".repeat(2 * 1024 * 1024) } },
      ]),
    ).toBeGreaterThan(SUMMARY_CACHE_BUDGET_BYTES);
  });

  it("counts escaped cache envelopes and multibyte text rather than plain string length", () => {
    const items = [{ title: '中文 "quoted" \\ path\n'.repeat(100) }];
    const rawJson = JSON.stringify(items);
    expect(measureSummaryCacheEntryBytes(items)).toBeGreaterThan(Buffer.byteLength(rawJson));
    expect(Buffer.byteLength(rawJson)).toBeGreaterThan(rawJson.length);
  });

  it("warns above budget with safe size metadata and stays quiet for small entries", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      warnOnSummaryCacheBudget([{ title: "Small" }], "pages");
      expect(warn).not.toHaveBeenCalled();
      const payload = [{ custom: "private-upstream-token", value: "汉".repeat(700_000) }];
      warnOnSummaryCacheBudget(payload, "posts");
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        "[busabase-cms] Summary cache is approaching Next's default entry limit",
        {
          kind: "posts",
          recordCount: 1,
          serializedBytes: measureSummaryCacheEntryBytes(payload),
          budgetBytes: SUMMARY_CACHE_BUDGET_BYTES,
        },
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain("private-upstream-token");
    } finally {
      warn.mockRestore();
    }
  });
});
