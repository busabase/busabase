import { describe, expect, it } from "vitest";
import {
  clearNarrowing,
  EMPTY_SEARCH_PAGE_STATE,
  hasActiveNarrowing,
  parseSearchPageParams,
  presetToUpdatedAfter,
  searchPageHref,
  serializeSearchPageParams,
} from "./search-page";

describe("search page URL state", () => {
  it("round-trips a fully narrowed search", () => {
    const state = {
      query: "quarterly invoice",
      sources: ["records", "files"] as const,
      sort: "updated_asc" as const,
      datePreset: "30d" as const,
      inNodeId: "nod_123",
      createdBy: "local-admin",
    };
    const round = parseSearchPageParams(
      serializeSearchPageParams({ ...state, sources: [...state.sources] }),
    );
    expect(round).toEqual({ ...state, sources: [...state.sources] });
  });

  it("omits defaults so a plain search produces a short, pasteable URL", () => {
    const serialized = serializeSearchPageParams({
      ...EMPTY_SEARCH_PAGE_STATE,
      query: "invoice",
    });
    // Not `q=invoice&sort=relevance&when=any&in=&by=` — two equivalent searches
    // must also serialize identically, which writing empty defaults would break.
    expect(serialized).toBe("q=invoice");
  });

  it("degrades a hand-edited or truncated URL to defaults instead of throwing", () => {
    const state = parseSearchPageParams("?q=x&sort=sideways&when=fortnight&source=telepathy");
    expect(state.query).toBe("x");
    expect(state.sort).toBe("relevance");
    expect(state.datePreset).toBe("any");
    // An unknown source is dropped, NOT passed through — the procedure would
    // reject it, and a page that 400s on a shared link is worse than one that
    // shows the unfiltered search.
    expect(state.sources).toEqual([]);
  });

  it("dedupes repeated sources", () => {
    expect(parseSearchPageParams("?source=files&source=files&source=records").sources).toEqual([
      "files",
      "records",
    ]);
  });

  it("turns a preset into a real lower bound, and 'any' into none", () => {
    const now = new Date("2026-03-15T12:00:00.000Z");
    expect(presetToUpdatedAfter("any", now)).toBeUndefined();
    expect(presetToUpdatedAfter("7d", now)).toBe("2026-03-08T12:00:00.000Z");
    expect(presetToUpdatedAfter("30d", now)).toBe("2026-02-13T12:00:00.000Z");
  });

  it("knows when something other than the query is narrowing results", () => {
    expect(hasActiveNarrowing(EMPTY_SEARCH_PAGE_STATE)).toBe(false);
    // A query alone is not "narrowing" — otherwise the Clear control would
    // offer to erase the only thing the person actually typed.
    expect(hasActiveNarrowing({ ...EMPTY_SEARCH_PAGE_STATE, query: "invoice" })).toBe(false);
    expect(hasActiveNarrowing({ ...EMPTY_SEARCH_PAGE_STATE, createdBy: "kelly" })).toBe(true);
    expect(hasActiveNarrowing({ ...EMPTY_SEARCH_PAGE_STATE, sort: "created_asc" })).toBe(true);
  });

  it("keeps the query when clearing the filters", () => {
    const cleared = clearNarrowing({
      query: "invoice",
      sources: ["files"],
      sort: "updated_desc",
      datePreset: "7d",
      inNodeId: "nod_1",
      createdBy: "kelly",
    });
    expect(cleared).toEqual({ ...EMPTY_SEARCH_PAGE_STATE, query: "invoice" });
  });

  it("builds the escalation href the dialog hands off to", () => {
    expect(searchPageHref(EMPTY_SEARCH_PAGE_STATE)).toBe("/search");
    expect(searchPageHref({ ...EMPTY_SEARCH_PAGE_STATE, query: "invoice" })).toBe(
      "/search?q=invoice",
    );
  });
});
