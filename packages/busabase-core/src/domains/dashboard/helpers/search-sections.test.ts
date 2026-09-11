import { describe, expect, it } from "vitest";
import {
  isNodeSection,
  KIND_FOR_SECTION,
  SEARCH_FILTERS,
  type SearchFilterKey,
  type SearchSectionKey,
  searchFiltersFor,
  sectionsFor,
  visibleSectionsFor,
} from "./search-sections";

describe("sectionsFor", () => {
  it("browses your own things with an empty query, and matches everything with one", () => {
    expect(sectionsFor("all", false)).toEqual(["recent", "apps", "skills"]);
    expect(sectionsFor("all", true)).toEqual([
      "recent",
      "workspace",
      "records",
      "files",
      "docContent",
      "bases",
      "changeRequests",
    ]);
  });

  // An app matches by name, so with a query it is already under recent/workspace.
  // A second "Apps" heading would show the same node twice.
  it("drops the apps and skills headings once a query can surface them by name", () => {
    expect(sectionsFor("all", true)).not.toContain("apps");
    expect(sectionsFor("all", true)).not.toContain("skills");
  });

  it("shows nothing for content filters with no query — there is no browse-all-records", () => {
    expect(sectionsFor("records", false)).toEqual([]);
    expect(sectionsFor("files", false)).toEqual([]);
    expect(sectionsFor("changeRequests", false)).toEqual([]);
  });

  it("narrows to exactly one section for every non-all filter", () => {
    for (const filter of SEARCH_FILTERS.filter((f) => f !== "all")) {
      expect(sectionsFor(filter, true)).toHaveLength(1);
    }
  });

  // The redesign replaced tabs with sections; it must not have removed reach.
  // Every tab that existed before has a filter that still reaches it.
  it("keeps a filter for every tab it replaced", () => {
    expect(SEARCH_FILTERS).toEqual(["all", "apps", "skills", "records", "files", "changeRequests"]);
  });
});

describe("anonymous visitors", () => {
  it("loses the apps and skills filters", () => {
    expect(searchFiltersFor(true)).toEqual(["all", "records", "files", "changeRequests"]);
  });

  it("keeps every filter for a member", () => {
    expect(searchFiltersFor(false)).toEqual(SEARCH_FILTERS);
  });

  it("never renders an apps or skills section, whichever filter is active", () => {
    for (const filter of SEARCH_FILTERS) {
      for (const hasQuery of [true, false]) {
        const sections = visibleSectionsFor(filter, hasQuery, true);
        expect(sections).not.toContain("apps");
        expect(sections).not.toContain("skills");
      }
    }
  });

  it("leaves a member's sections untouched", () => {
    expect(visibleSectionsFor("all", false, false)).toEqual(sectionsFor("all", false));
  });
});

describe("section classification", () => {
  it("separates node-name sections from search()-backed ones", () => {
    const nodeSections: SearchSectionKey[] = ["recent", "workspace", "apps", "skills"];
    const contentSections: SearchSectionKey[] = [
      "records",
      "files",
      "docContent",
      "bases",
      "changeRequests",
    ];
    expect(nodeSections.every(isNodeSection)).toBe(true);
    expect(contentSections.some(isNodeSection)).toBe(false);
  });

  // `sources: ["records"]` returns record AND change_request rows, so scoping the
  // request is not enough on its own — each content section also pins its kind.
  it("pins a result kind for every content section", () => {
    for (const section of sectionsFor("all", true)) {
      if (isNodeSection(section)) continue;
      expect(KIND_FOR_SECTION[section]).toBeDefined();
    }
  });

  it("gives node sections no kind — they never read search() results", () => {
    for (const section of ["recent", "workspace", "apps", "skills"] as const) {
      expect(KIND_FOR_SECTION[section]).toBeUndefined();
    }
  });

  // The caller maps this into JSX and the active filter is persisted state, so
  // a key this table forgets must degrade to "nothing under this filter", not
  // to a crash that blanks the dialog.
  it("returns an empty list for an unknown filter rather than undefined", () => {
    expect(sectionsFor("nope" as SearchFilterKey, true)).toEqual([]);
    expect(sectionsFor("nope" as SearchFilterKey, false)).toEqual([]);
  });
});
