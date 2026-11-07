import { describe, expect, it } from "vitest";
import {
  MIN_MATCH_MS,
  POST_MATCH_RESERVE_MS,
  planMatchBudgetMs,
  runWithin,
  settleBefore,
} from "../src/logic/search-budget";
import { type MatchRow, orderMatchGroups } from "../src/logic/search-record-query";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("planMatchBudgetMs", () => {
  it("gives matching half of what is left when the rest still covers the reserve", () => {
    expect(planMatchBudgetMs(1_990)).toBeCloseTo(995);
    expect(planMatchBudgetMs(4_990)).toBeCloseTo(2_495);
  });

  it("keeps the post-match reserve when little is left", () => {
    // 900 ms left: half would be 450, leaving 450 < the 800 ms reserve.
    expect(planMatchBudgetMs(900)).toBe(MIN_MATCH_MS);
    expect(planMatchBudgetMs(1_200)).toBeCloseTo(1_200 - POST_MATCH_RESERVE_MS);
  });

  it("never starves matching", () => {
    for (const left of [0, 100, 400, 700]) expect(planMatchBudgetMs(left)).toBe(MIN_MATCH_MS);
  });
});

describe("settleBefore", () => {
  it("returns the value when the work finishes in time", async () => {
    await expect(
      settleBefore(
        sleep(10).then(() => 7),
        Date.now() + 500,
      ),
    ).resolves.toEqual({
      value: 7,
    });
  });

  it("returns null when time runs out first, and swallows the late outcome", async () => {
    const late = sleep(80).then(() => {
      throw new Error("late failure");
    });
    await expect(settleBefore(late, Date.now() + 10)).resolves.toBeNull();
    // The late rejection must not surface as unhandled.
    await sleep(120);
  });

  it("returns null at once when the time is already up", async () => {
    await expect(settleBefore(Promise.resolve(1), Date.now() - 1)).resolves.toBeNull();
  });

  it("passes a failure that happens in time", async () => {
    await expect(settleBefore(Promise.reject(new Error("boom")), Date.now() + 500)).rejects.toThrow(
      "boom",
    );
  });
});

describe("runWithin", () => {
  it("runs every item, in order, when there is time", async () => {
    const out = await runWithin([1, 2, 3, 4, 5], async (n) => n * 2, {
      until: Date.now() + 1_000,
      chunkSize: 2,
    });
    expect(out).toEqual({ results: [2, 4, 6, 8, 10], complete: true });
  });

  it("stops at the deadline with the finished prefix, never a gap", async () => {
    // Items 0 and 1 are quick, 2 is slow, 3 is quick again: 3 must not appear.
    const out = await runWithin(
      [0, 1, 2, 3],
      async (n) => {
        if (n === 2) await sleep(300);
        return n;
      },
      { until: Date.now() + 100, chunkSize: 4 },
    );
    expect(out).toEqual({ results: [0, 1], complete: false });
  });

  it("does not start a chunk after the deadline", async () => {
    const started: number[] = [];
    const out = await runWithin(
      [0, 1, 2, 3, 4, 5],
      async (n) => {
        started.push(n);
        await sleep(60);
        return n;
      },
      { until: Date.now() + 100, chunkSize: 2 },
    );
    // The first chunk finished at 60 ms and the second started; it was cut at
    // 100 ms, and the third never began.
    expect(out).toEqual({ results: [0, 1], complete: false });
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it("fails when an item fails in time", async () => {
    await expect(
      runWithin(
        [1, 2],
        async (n) => {
          if (n === 2) throw new Error("hydration failed");
          return n;
        },
        { until: Date.now() + 500, chunkSize: 2 },
      ),
    ).rejects.toThrow("hydration failed");
  });
});

describe("orderMatchGroups", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
  const row = (
    id: string,
    recordId: string | null,
    changeRequestId: string | null,
    updated: number,
    created: number,
  ): MatchRow => ({
    id,
    at: updated,
    recordId,
    changeRequestId,
    updatedAt: at(updated),
    createdAt: at(created),
  });
  const rows = [
    // record a: edited late, created early; two values.
    row("v1", "a", null, 50, 1),
    row("v2", "a", null, 10, 1),
    // record b: edited early, created late.
    row("v3", "b", null, 20, 40),
    // a change request's proposal.
    row("v4", null, "cr1", 30, 30),
  ];
  const keys = (sort: Parameters<typeof orderMatchGroups>[1], limit = 10) =>
    orderMatchGroups(rows, sort, limit).map((group) => group.recordId ?? group.changeRequestId);

  it("groups values by record or change request", () => {
    expect(keys("updated_desc")).toHaveLength(3);
  });

  it("orders by the newest edit for updated_desc and relevance's fallback", () => {
    expect(keys("updated_desc")).toEqual(["a", "cr1", "b"]);
    expect(keys("relevance")).toEqual(["a", "cr1", "b"]);
  });

  it("orders by the oldest edit for updated_asc", () => {
    // a's oldest edit is 10, b's 20, cr1's 30.
    expect(keys("updated_asc")).toEqual(["a", "b", "cr1"]);
  });

  it("orders by creation time for the created sorts", () => {
    expect(keys("created_desc")).toEqual(["b", "cr1", "a"]);
    expect(keys("created_asc")).toEqual(["a", "cr1", "b"]);
  });

  it("keeps only the first `limit` groups", () => {
    expect(keys("updated_desc", 2)).toEqual(["a", "cr1"]);
  });
});
