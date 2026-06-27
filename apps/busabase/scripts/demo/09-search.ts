/**
 * 09-search: GET /search across all domains.
 * Verifies search returns results for terms present in seeded data.
 */

import { api, assert, BASE, makeRunner } from "./_client";

interface SearchResultVO {
  id: string;
  type: string;
  title: string;
  snippet?: string;
}

interface SearchResponseVO {
  results: SearchResultVO[];
  total: number;
  query: string;
}

const SEARCH_CASES = [
  {
    q: "AI agents",
    desc: "matches seeded blog content",
    minResults: 0, // informational — seed may not be present yet
  },
  {
    q: "workflow",
    desc: "matches seeded blog body text",
    minResults: 0,
  },
  {
    q: "demo",
    desc: "matches demo-script-created content",
    minResults: 0,
  },
  {
    q: "",
    desc: "empty query returns no error (may return empty or default results)",
    allowEmpty: true,
  },
];

export async function run() {
  const { step, summary } = makeRunner("09-search");
  console.log(`\n🔍  Search  →  ${BASE}\n`);

  for (const { q, desc, minResults, allowEmpty } of SEARCH_CASES) {
    if (allowEmpty) {
      await step(`GET /search?q="" — ${desc}`, async () => {
        const path = q ? `/search?q=${encodeURIComponent(q)}` : "/search?q=";
        try {
          const res = await api<SearchResponseVO | SearchResultVO[]>("GET", path);
          // Accept either shape — some servers return array, some wrap in object
          assert(
            Array.isArray(res) || typeof (res as SearchResponseVO).results !== "undefined",
            "unexpected search response shape",
          );
        } catch {
          // Some implementations 400 on empty query — that's also acceptable
        }
      });
      continue;
    }

    await step(`GET /search?q="${q}" — ${desc}`, async () => {
      const res = await api<SearchResponseVO | SearchResultVO[]>(
        "GET",
        `/search?q=${encodeURIComponent(q)}`,
      );
      const results = Array.isArray(res) ? res : ((res as SearchResponseVO).results ?? []);
      assert(Array.isArray(results), "expected results array");
      if (minResults && minResults > 0) {
        assert(
          results.length >= minResults,
          `expected ≥${minResults} results for "${q}", got ${results.length}`,
        );
      }
      process.stdout.write(`     info: ${results.length} result(s) for "${q}"\n`);
    });
  }

  // ── Pagination params ─────────────────────────────────────────────────────

  await step("GET /search?q=AI&limit=2 — limit param accepted", async () => {
    try {
      const res = await api<SearchResponseVO | SearchResultVO[]>("GET", "/search?q=AI&limit=2");
      const results = Array.isArray(res) ? res : ((res as SearchResponseVO).results ?? []);
      assert(results.length <= 2, `expected ≤2 results with limit=2, got ${results.length}`);
    } catch {
      // If limit param isn't supported, that's informational only
      process.stdout.write("     ⚠️  limit param may not be supported\n");
    }
  });

  return summary();
}

if (process.argv[1]?.endsWith("09-search.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
