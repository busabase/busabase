import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

/**
 * A search that has found matches does not fail on the request deadline.
 *
 * Quick searches have 2 s. Finding matches may use half of it; what came after
 * (ordering, reading and hydrating the rows) used to run on into the deadline
 * and answer 408 with the matches already in hand — about one request in
 * thirty on a cold database. Now relevance ordering falls back to update order,
 * hydration stops before the deadline and answers with the rows it finished,
 * both marked incomplete, and only a search with not one row to show is a
 * timeout.
 *
 * The slow stages are forced, not hoped for: record hydration is delayed per
 * record id through a mocked `hydrateRecord`, relevance ordering reports that
 * it could not finish through a mocked `rankRelevance`, and the match scope is
 * held back until a chosen moment through a mocked `findRecordMatches`.
 */

const hydration = vi.hoisted(() => ({
  /** Record ids whose hydration takes `slowMs`; every other one is instant. */
  slow: new Set<string>(),
  slowMs: 4_000,
  /** When set, ordering by relevance reports it ran out of time. */
  rankTimesOut: false,
  /** When set, the match scope returns no earlier than this many ms after the request began. */
  matchEndsAtMs: 0,
  requestStartedAt: 0,
}));

vi.mock("../src/logic/cr-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/logic/cr-lifecycle")>();
  return {
    ...actual,
    hydrateRecord: async (record: { id: string }) => {
      if (hydration.slow.has(record.id)) {
        await new Promise((resolve) => setTimeout(resolve, hydration.slowMs));
      }
      return actual.hydrateRecord(record as never);
    },
  };
});

vi.mock("../src/logic/search-record-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/logic/search-record-query")>();
  return {
    ...actual,
    rankRelevance: (...args: Parameters<typeof actual.rankRelevance>) =>
      hydration.rankTimesOut ? Promise.resolve(null) : actual.rankRelevance(...args),
    findRecordMatches: async (...args: Parameters<typeof actual.findRecordMatches>) => {
      const found = await actual.findRecordMatches(...args);
      const wait = hydration.requestStartedAt + hydration.matchEndsAtMs - Date.now();
      if (hydration.matchEndsAtMs && wait > 0) await new Promise((r) => setTimeout(r, wait));
      return found;
    },
  };
});

const raw = () => createRouterClient(busabaseRouter);

const REQUEST_MS = "BUSABASE_SEARCH_QUICK_REQUEST_TIMEOUT_MS";

describe("record search at the request deadline", () => {
  const original = process.env[REQUEST_MS];
  beforeEach(() => {
    process.env[REQUEST_MS] = "1500";
    hydration.slow.clear();
    hydration.rankTimesOut = false;
    hydration.matchEndsAtMs = 0;
  });
  afterEach(() => {
    if (original === undefined) delete process.env[REQUEST_MS];
    else process.env[REQUEST_MS] = original;
  });

  const seed = async (name: string, count: number) => {
    const { client } = await seedScenario(name);
    const base = await client.bases.create({ slug: "deadline", name: "Deadline" });
    const created: Array<{ recordId: string; title: string }> = [];
    for (let index = 0; index < count; index++) {
      const title = `deadlineword note ${index}`;
      const record = await client.records.createChangeRequest({
        baseId: base.id,
        fields: { title },
        mergeImmediately: true,
      });
      created.push({ recordId: record.id, title });
    }
    // Newest first, the order a quick search ranks by update time.
    return created.reverse();
  };

  const search = (sort: "updated_desc" | "relevance", query = "deadlineword") => {
    hydration.requestStartedAt = Date.now();
    return raw().search({ query, sources: ["records"], mode: "quick", sort });
  };

  it("answers with the rows it finished when hydration reaches the deadline", async () => {
    const newest = await seed("deadline-hydration", 12);
    // The three newest are built at once; the rest would take far past the deadline.
    for (const { recordId } of newest.slice(3)) hydration.slow.add(recordId);

    const startedAt = Date.now();
    const result = await search("updated_desc");

    expect(result.results.map((row) => row.id)).toEqual(
      newest.slice(0, 3).map((row) => row.recordId),
    );
    expect(result.contentTruncated).toBe(true);
    // It stopped on its own before the deadline instead of waiting the 4 s out.
    expect(Date.now() - startedAt).toBeLessThan(1_500);
  }, 60_000);

  it("is a timeout only when not one row could be built", async () => {
    const newest = await seed("deadline-nothing", 4);
    for (const { recordId } of newest) hydration.slow.add(recordId);

    await expect(search("updated_desc")).rejects.toMatchObject({ code: "TIMEOUT" });
  }, 60_000);

  it("orders by update time, marked incomplete, when relevance ordering cannot finish", async () => {
    const newest = await seed("deadline-rank", 5);
    hydration.rankTimesOut = true;

    const result = await search("relevance");

    expect(result.results.map((row) => row.id)).toEqual(newest.map((row) => row.recordId));
    expect(result.contentTruncated).toBe(true);
  }, 60_000);

  it("keeps its matches when the match scope itself comes back after the deadline", async () => {
    const newest = await seed("deadline-late-match", 5);
    // The deadline is 1,500 ms; matching comes back at 1,650, past it but within
    // the allowance for a statement that was slow to honour its cancel.
    hydration.matchEndsAtMs = 1_650;

    const result = await search("updated_desc");

    expect(result.results.map((row) => row.id)).toEqual(newest.map((row) => row.recordId));
  }, 60_000);

  it("keeps what the match scope found when it comes back later than its allowance", async () => {
    const newest = await seed("deadline-very-late-match", 5);
    // Back at 2,000 ms: past the deadline (1,500) and past the allowance (300 more).
    // A cancel that was slow to be honoured; the scope's result is discarded as a
    // timeout, but the matches it had already found are not.
    hydration.matchEndsAtMs = 2_000;

    const result = await search("updated_desc");

    expect(result.results.map((row) => row.id)).toEqual(newest.map((row) => row.recordId));
    expect(result.contentTruncated).toBe(true);
  }, 60_000);

  it("is a timeout when a scope that comes back late had found nothing", async () => {
    await seed("deadline-late-and-empty", 3);
    hydration.matchEndsAtMs = 2_000;

    await expect(search("updated_desc", "wordnobodywrote")).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  }, 60_000);

  it("is a timeout when matching ends past the deadline and not one row builds in time", async () => {
    const newest = await seed("deadline-late-and-slow", 4);
    for (const { recordId } of newest) hydration.slow.add(recordId);
    hydration.matchEndsAtMs = 1_650;

    await expect(search("updated_desc")).rejects.toMatchObject({ code: "TIMEOUT" });
  }, 60_000);

  it("stays complete and unmarked when nothing runs late", async () => {
    const newest = await seed("deadline-on-time", 5);

    const result = await search("updated_desc");

    expect(result.results.map((row) => row.id)).toEqual(newest.map((row) => row.recordId));
    expect(result.contentTruncated).toBe(false);
  }, 60_000);
});
