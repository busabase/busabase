import type { SearchResultVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  keepKindsForTab,
  mergeTabResults,
  type SearchGroupResponse,
  sourceGroupsForTab,
} from "./search-sources";

const result = (
  id: string,
  kind: SearchResultVO["kind"],
  overrides: Partial<SearchResultVO> = {},
): SearchResultVO => ({
  id,
  kind,
  title: id,
  body: "",
  eyebrow: "",
  href: `/${kind}/${id}`,
  updatedAt: null,
  createdBy: null,
  ...overrides,
});

const group = (
  results: SearchResultVO[],
  overrides: Partial<SearchGroupResponse> = {},
): SearchGroupResponse => ({
  results,
  hasMore: false,
  contentTruncated: false,
  ...overrides,
});

describe("sourceGroupsForTab", () => {
  it("asks the server for the sources each tab is about", () => {
    // The bug this fixes: every tab was served from ONE unscoped call, which
    // the server fills records-first — so the Files tab filtered a page of
    // records down to nothing and rendered "no results" while the server had
    // matching files.
    expect(sourceGroupsForTab("files")).toEqual([["files"]]);
    expect(sourceGroupsForTab("records")).toEqual([["records"]]);
  });

  it("gives records their own budget on All, so they cannot crowd out the rest", () => {
    // Two groups, not one: a shared limit is always won by records.
    const groups = sourceGroupsForTab("all");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(["records"]);
    expect(groups[1]).toEqual(expect.arrayContaining(["files", "names", "nodes"]));
  });

  it("reads change requests out of the records source, which is where they come from", () => {
    expect(sourceGroupsForTab("change_requests")).toEqual([["records"]]);
  });

  it("sends no request for Recent, which is a local cache", () => {
    expect(sourceGroupsForTab("recent")).toEqual([]);
  });
});

describe("keepKindsForTab", () => {
  const mixed = [
    result("r1", "record"),
    result("cr1", "change_request"),
    result("b1", "base"),
    result("f1", "file"),
    result("n1", "node"),
  ];

  it("separates records from the change requests the same source returns", () => {
    // `sources: ["records"]` answers with both kinds, so scoping alone is not
    // enough to tell the Records tab from the Change requests tab.
    expect(keepKindsForTab("records", mixed).map((r) => r.id)).toEqual(["r1"]);
    expect(keepKindsForTab("change_requests", mixed).map((r) => r.id)).toEqual(["cr1"]);
  });

  it("keeps every kind except change requests on All", () => {
    expect(keepKindsForTab("all", mixed).map((r) => r.id)).toEqual(["r1", "b1", "f1", "n1"]);
  });
});

describe("mergeTabResults", () => {
  it("keeps each group's own ordering instead of interleaving them", () => {
    // `relevance` means "let each source use the ranking it has" — a record's
    // text rank and a file's recency are not comparable, so re-sorting across
    // groups would invent an order the server never claimed.
    const merged = mergeTabResults("all", [
      group([result("r1", "record"), result("r2", "record")]),
      group([result("f1", "file"), result("b1", "base")]),
    ]);

    expect(merged.results.map((r) => r.id)).toEqual(["r1", "r2", "f1", "b1"]);
  });

  it("surfaces a file that a single shared page would have dropped", () => {
    // The end-to-end shape of the bug: a full page of records in one group,
    // and the file in the other. Under the old single call the file was simply
    // absent.
    const records = Array.from({ length: 20 }, (_, i) => result(`r${i}`, "record"));
    const merged = mergeTabResults("all", [
      group(records, { hasMore: true }),
      group([result("f1", "file")]),
    ]);

    expect(merged.results.some((r) => r.kind === "file")).toBe(true);
    expect(merged.hasMore).toBe(true);
  });

  it("does not show the same result twice when groups overlap", () => {
    const merged = mergeTabResults("all", [
      group([result("x", "record")]),
      group([result("x", "record")]),
    ]);

    expect(merged.results).toHaveLength(1);
  });

  it("reports truncated content when ANY group could not see everything", () => {
    // Load-bearing for honesty: the contract adds `contentTruncated` so that
    // "no results" can be told apart from "we did not look at all of it".
    // Swallowing it turns the second into the first.
    const merged = mergeTabResults("all", [
      group([], { contentTruncated: false }),
      group([], { contentTruncated: true }),
    ]);

    expect(merged.contentTruncated).toBe(true);
  });

  it("drops kinds that do not belong to the tab, group by group", () => {
    const merged = mergeTabResults("files", [
      group([result("r1", "record"), result("f1", "file")]),
    ]);

    expect(merged.results.map((r) => r.id)).toEqual(["f1"]);
  });
});
