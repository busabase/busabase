import { describe, expect, it } from "vitest";
import {
  clearNarrowing,
  EMPTY_SEARCH_PAGE_STATE,
  hasActiveNarrowing,
  isValidPattern,
  parseSearchPageParams,
  patternFlags,
  presetToUpdatedAfter,
  searchPageHref,
  serializeSearchPageParams,
  sourcesForMode,
} from "./search-page";

describe("search page URL state", () => {
  it("round-trips a fully narrowed search", () => {
    const state = {
      ...EMPTY_SEARCH_PAGE_STATE,
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
      ...EMPTY_SEARCH_PAGE_STATE,
      query: "invoice",
      sources: ["files"],
      sort: "updated_desc",
      datePreset: "7d",
      inNodeId: "nod_1",
      createdBy: "kelly",
    });
    expect(cleared).toEqual({ ...EMPTY_SEARCH_PAGE_STATE, query: "invoice" });
  });

  it("keeps the MODE when clearing the filters", () => {
    // Dropping back to text would re-run the pattern as a literal — a different
    // question with a plausible-looking answer, which is the worst kind of wrong.
    const cleared = clearNarrowing({
      ...EMPTY_SEARCH_PAGE_STATE,
      query: "inv.*ce",
      mode: "regex",
      caseSensitive: true,
      sources: ["files"],
    });
    expect(cleared.mode).toBe("regex");
    expect(cleared.caseSensitive).toBe(true);
    expect(cleared.sources).toEqual([]);
  });

  it("builds the escalation href the dialog hands off to", () => {
    expect(searchPageHref(EMPTY_SEARCH_PAGE_STATE)).toBe("/search");
    expect(searchPageHref({ ...EMPTY_SEARCH_PAGE_STATE, query: "invoice" })).toBe(
      "/search?q=invoice",
    );
  });

  describe("regex mode", () => {
    it("round-trips the mode and its case flag", () => {
      const state = {
        ...EMPTY_SEARCH_PAGE_STATE,
        query: "inv[0-9]+",
        mode: "regex" as const,
        caseSensitive: true,
        sources: ["files" as const],
      };
      expect(parseSearchPageParams(serializeSearchPageParams(state))).toEqual(state);
    });

    it("never writes filters grep does not honour", () => {
      // A regex URL carrying `sort` / `when` / `in` / `by` would promise narrowing that
      // grep never applied — the link would describe a search nobody ran.
      const serialized = serializeSearchPageParams({
        ...EMPTY_SEARCH_PAGE_STATE,
        query: "inv.*",
        mode: "regex",
        sort: "updated_desc",
        datePreset: "7d",
        inNodeId: "nod_finance",
        createdBy: "kelly",
        sources: ["names"],
      });
      expect(serialized).toBe("q=inv.*&mode=regex");
    });

    it("drops a text-search subtree from a hand-edited regex link", () => {
      const state = parseSearchPageParams("?q=inv.*&mode=regex&in=nod_finance");
      expect(state.inNodeId).toBe("");
      expect(hasActiveNarrowing(state)).toBe(false);
    });

    it("drops a source grep cannot scan out of a hand-edited link", () => {
      // grep scans content; a node NAME has no line to report a hit on.
      const state = parseSearchPageParams("?q=x&mode=regex&source=names&source=files");
      expect(state.sources).toEqual(["files"]);
    });

    it("keeps `names` in text mode", () => {
      expect(parseSearchPageParams("?q=x&source=names").sources).toEqual(["names"]);
    });

    it("offers only the sources each mode can actually scan", () => {
      expect(sourcesForMode("text")).toContain("names");
      expect(sourcesForMode("regex")).not.toContain("names");
    });

    it("does not count an unhonoured filter as active narrowing", () => {
      // Otherwise the page would offer a Clear control for a filter it is not
      // applying and does not display.
      expect(
        hasActiveNarrowing({ ...EMPTY_SEARCH_PAGE_STATE, mode: "regex", sort: "created_asc" }),
      ).toBe(false);
      expect(
        hasActiveNarrowing({ ...EMPTY_SEARCH_PAGE_STATE, mode: "regex", inNodeId: "nod_1" }),
      ).toBe(false);
      expect(
        hasActiveNarrowing({ ...EMPTY_SEARCH_PAGE_STATE, mode: "text", sort: "created_asc" }),
      ).toBe(true);
    });

    it("defaults to case-INSENSITIVE so a miss means absent, not mis-cased", () => {
      expect(patternFlags({ caseSensitive: false })).toBe("i");
      expect(patternFlags({ caseSensitive: true })).toBe("");
    });

    it("rejects a pattern the engine cannot compile, before any request goes out", () => {
      expect(isValidPattern("inv[0-9]+", "i")).toBe(true);
      expect(isValidPattern("inv[", "i")).toBe(false);
      expect(isValidPattern("(unclosed", "")).toBe(false);
    });
  });
});
