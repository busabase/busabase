import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import {
  assertEvaluable,
  PAGE_DEPTH_LIMIT,
  pageResponse,
  pageWindow,
  VIEW_TOO_LARGE_MESSAGE,
} from "../src/domains/base/logic/record-list-guards";

describe("page window", () => {
  it("stops page numbers at the first 100,000 records", () => {
    expect(pageWindow(1, 50, 1_000_000)).toEqual({
      page: 1,
      totalPages: 2_000,
      offset: 0,
      pagesCapped: true,
    });
    // A deeper page is served as the last reachable one, never as an OFFSET of millions.
    expect(pageWindow(20_000, 50, 1_000_000)).toMatchObject({
      page: 2_000,
      offset: PAGE_DEPTH_LIMIT - 50,
    });
    expect(pageWindow(5, 100, 1_000_000).totalPages).toBe(1_000);
  });

  it("caps only what is past the limit", () => {
    expect(pageWindow(1, 50, PAGE_DEPTH_LIMIT)).toMatchObject({
      totalPages: 2_000,
      pagesCapped: false,
    });
    expect(pageWindow(1, 50, PAGE_DEPTH_LIMIT + 1).pagesCapped).toBe(true);
    expect(pageWindow(3, 50, 120)).toEqual({
      page: 3,
      totalPages: 3,
      offset: 100,
      pagesCapped: false,
    });
    expect(pageWindow(4, 50, 0)).toEqual({ page: 1, totalPages: 0, offset: 0, pagesCapped: false });
  });
});

describe("page response", () => {
  it("adds the capped flags only when they apply", () => {
    const small = pageResponse([], { total: 3, totalCapped: false }, pageWindow(1, 50, 3), 50);
    expect(small).toEqual({ records: [], total: 3, totalPages: 1, page: 1, pageSize: 50 });
    const huge = pageResponse(
      [],
      { total: 1_000_000, totalCapped: true },
      pageWindow(1, 50, 1_000_000),
      50,
    );
    expect(huge).toMatchObject({ total: 1_000_000, totalCapped: true, pagesCapped: true });
  });
});

describe("in-process evaluation", () => {
  it("refuses more than 1,000,000 candidate rows instead of loading them", () => {
    expect(() => assertEvaluable(new Array(1_000_000))).not.toThrow();
    let thrown: unknown;
    try {
      assertEvaluable(new Array(1_000_001));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ORPCError);
    expect((thrown as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
    expect((thrown as Error).message).toBe(VIEW_TOO_LARGE_MESSAGE);
  });
});
