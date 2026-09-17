import { describe, expect, it } from "vitest";
import { getSearchTabOptions, normalizeSearchText } from "./search-results";

describe("search result presentation", () => {
  it("normalizes queries for debounce freshness checks", () => {
    expect(normalizeSearchText("  Ada LOVELACE  ")).toBe("ada lovelace");
  });

  it("numbers only the tab it actually fetched", () => {
    // The bug this replaces: every badge was derived from ONE shared page, so
    // the Files badge read 0 whenever records filled that page — against a
    // workspace that had matching files. Each tab is its own scoped request
    // now, so the inactive ones have genuinely not been asked and must not
    // claim a number.
    const options = getSearchTabOptions({
      activeTab: "files",
      count: 3,
      hasMore: false,
      recentCount: 2,
    });

    expect(options).toEqual([
      { value: "recent", label: "Recent", meta: 2 },
      { value: "all", label: "All" },
      { value: "records", label: "Records" },
      { value: "files", label: "Files", meta: "3" },
      { value: "change_requests", label: "Change requests" },
    ]);
  });

  it("renders a full page as a floor, not as a total", () => {
    // A badge is read as a total. When the server says there is another page,
    // the honest rendering of 20 fetched rows is "20+".
    const [, , , files] = getSearchTabOptions({
      activeTab: "files",
      count: 20,
      hasMore: true,
      recentCount: 0,
    });

    expect(files?.meta).toBe("20+");
  });

  it("shows no badge for a tab with nothing in it", () => {
    const options = getSearchTabOptions({
      activeTab: "files",
      count: 0,
      hasMore: false,
      recentCount: 0,
    });

    expect(options.every((option) => option.meta === undefined)).toBe(true);
  });

  it("keeps the Recent badge, which is a complete local count", () => {
    // Recent is the visited-node cache on this device — not a page of a larger
    // server-side set — so its number is a total and stays a plain one.
    const [recent] = getSearchTabOptions({
      activeTab: "all",
      count: 0,
      hasMore: true,
      recentCount: 5,
    });

    expect(recent?.meta).toBe(5);
  });
});
