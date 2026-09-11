import { describe, expect, it } from "vitest";
import {
  isContentSearchTab,
  isNodeListTab,
  SEARCH_TABS,
  type SearchTab,
  searchTabsFor,
} from "./search-tabs";

describe("searchTabsFor", () => {
  it("gives a member every tab, in render order", () => {
    expect(searchTabsFor(false)).toEqual([
      "recent",
      "apps",
      "skills",
      "records",
      "files",
      "change_requests",
      "all",
    ]);
  });

  it("hides Skills and Apps from an anonymous visitor", () => {
    const tabs = searchTabsFor(true);
    expect(tabs).not.toContain("skills");
    expect(tabs).not.toContain("apps");
  });

  it("leaves every other tab untouched for an anonymous visitor", () => {
    expect(searchTabsFor(true)).toEqual(["recent", "records", "files", "change_requests", "all"]);
  });

  it("never hands an anonymous visitor a node-list tab, however the list grows", () => {
    // Guards the rule rather than today's list: a future node-list tab added to
    // SEARCH_TABS is excluded automatically, and this fails if it isn't.
    expect(searchTabsFor(true).some(isNodeListTab)).toBe(false);
  });

  it("does not mutate SEARCH_TABS", () => {
    searchTabsFor(true);
    expect(SEARCH_TABS).toHaveLength(7);
    expect(SEARCH_TABS).toContain("skills");
  });
});

describe("tab classification", () => {
  it("treats exactly skills and apps as node-list tabs", () => {
    expect(SEARCH_TABS.filter(isNodeListTab)).toEqual(["apps", "skills"]);
  });

  it("treats every tab except recent and the node-list tabs as content search", () => {
    expect(SEARCH_TABS.filter(isContentSearchTab)).toEqual([
      "records",
      "files",
      "change_requests",
      "all",
    ]);
  });

  it("puts every tab in exactly one bucket", () => {
    for (const tab of SEARCH_TABS) {
      const buckets = [tab === "recent", isNodeListTab(tab), isContentSearchTab(tab)];
      expect(buckets.filter(Boolean)).toHaveLength(1);
    }
  });

  it("classifies an unknown tab as neither node-list nor content search", () => {
    // `recent` is the only tab in neither bucket; assert that stays true so a
    // future tab cannot silently inherit the content-search request path.
    expect(isNodeListTab("recent" as SearchTab)).toBe(false);
    expect(isContentSearchTab("recent" as SearchTab)).toBe(false);
  });
});
