import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  EMPTY_SEARCH_FILTERS,
  hasActiveFilters,
  searchFilterInput,
} from "./search-filters";

const NOW = new Date("2026-09-22T12:00:00.000Z");

describe("searchFilterInput", () => {
  it("sends nothing at all when nothing is narrowed", () => {
    // Omitted, not sent as defaults: an unfiltered search must produce exactly
    // the request — and the react-query key — it produced before this feature.
    expect(searchFilterInput(EMPTY_SEARCH_FILTERS, NOW)).toEqual({});
  });

  it("sends a sort only when it is not the default", () => {
    expect(searchFilterInput({ ...EMPTY_SEARCH_FILTERS, sort: "updated_desc" }, NOW)).toEqual({
      sort: "updated_desc",
    });
  });

  it("turns a date preset into an inclusive ISO instant", () => {
    const { updatedAfter } = searchFilterInput({ ...EMPTY_SEARCH_FILTERS, datePreset: "7d" }, NOW);
    expect(updatedAfter).toBe("2026-09-15T12:00:00.000Z");
  });

  it("always stamps an offset, which the contract requires", () => {
    // The contract rejects a bare local time: `.datetime({ offset: true })`.
    // `toISOString()` always ends in Z, and this pins that it stays that way.
    for (const preset of ["7d", "30d", "365d"] as const) {
      const { updatedAfter } = searchFilterInput(
        { ...EMPTY_SEARCH_FILTERS, datePreset: preset },
        NOW,
      );
      expect(updatedAfter).toMatch(/Z$/);
    }
  });

  it("passes an author through verbatim", () => {
    // A free-form actor id, which may be an agent or an API key — never
    // normalised or compared against the signed-in user here.
    expect(
      searchFilterInput({ ...EMPTY_SEARCH_FILTERS, createdBy: "local-producer" }, NOW).createdBy,
    ).toBe("local-producer");
  });

  it("omits an empty author rather than sending a blank filter", () => {
    expect(searchFilterInput({ ...EMPTY_SEARCH_FILTERS, createdBy: "" }, NOW)).toEqual({});
  });

  it("combines every active narrowing", () => {
    const input = searchFilterInput(
      { sort: "created_asc", datePreset: "30d", createdBy: "usr_1" },
      NOW,
    );
    expect(input).toEqual({
      sort: "created_asc",
      updatedAfter: "2026-08-23T12:00:00.000Z",
      createdBy: "usr_1",
    });
  });
});

describe("activeFilterCount", () => {
  it("counts nothing for the default state", () => {
    expect(activeFilterCount(EMPTY_SEARCH_FILTERS)).toBe(0);
    expect(hasActiveFilters(EMPTY_SEARCH_FILTERS)).toBe(false);
  });

  it("counts each narrowing once", () => {
    expect(activeFilterCount({ sort: "updated_desc", datePreset: "any", createdBy: "" })).toBe(1);
    expect(activeFilterCount({ sort: "relevance", datePreset: "7d", createdBy: "" })).toBe(1);
    expect(activeFilterCount({ sort: "relevance", datePreset: "any", createdBy: "x" })).toBe(1);
    expect(activeFilterCount({ sort: "created_desc", datePreset: "7d", createdBy: "x" })).toBe(3);
  });
});
