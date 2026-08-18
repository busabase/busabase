import type { SearchResultVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { filterSearchResults, getSearchTabOptions, normalizeSearchText } from "./search-results";

const results: SearchResultVO[] = [
  {
    id: "record-1",
    kind: "record",
    title: "Ada",
    body: "",
    eyebrow: "People",
    href: "/records/1",
    updatedAt: null,
  },
  {
    id: "base-1",
    kind: "base",
    title: "People",
    body: "",
    eyebrow: "",
    href: "/base/people",
    updatedAt: null,
  },
  {
    id: "file-1",
    kind: "file",
    title: "Notes",
    body: "",
    eyebrow: "",
    href: "/doc/notes",
    updatedAt: null,
  },
  {
    id: "cr-1",
    kind: "change_request",
    title: "Update Ada",
    body: "",
    eyebrow: "",
    href: "/change-requests/cr-1",
    updatedAt: null,
  },
];

describe("search result presentation", () => {
  it("normalizes queries for debounce freshness checks", () => {
    expect(normalizeSearchText("  Ada LOVELACE  ")).toBe("ada lovelace");
  });

  it("keeps change requests out of All while retaining their dedicated tab", () => {
    expect(filterSearchResults(results, "all").map(({ kind }) => kind)).toEqual([
      "record",
      "base",
      "file",
    ]);
    expect(filterSearchResults(results, "change_requests")).toEqual([results[3]]);
  });

  it("counts the visible result kinds and the separate recent cache", () => {
    expect(getSearchTabOptions(results, 2)).toEqual([
      { value: "recent", label: "Recent", meta: 2 },
      { value: "all", label: "All", meta: 3 },
      { value: "records", label: "Records", meta: 1 },
      { value: "files", label: "Files", meta: 1 },
      { value: "change_requests", label: "Change requests", meta: 1 },
    ]);
  });
});
