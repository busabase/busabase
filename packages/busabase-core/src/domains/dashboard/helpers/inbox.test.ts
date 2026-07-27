import { mergeSearchIntoHref } from "openlib/ui/dashboard";
import { describe, expect, it } from "vitest";
import { type InboxViewKey, readInboxView } from "./inbox";

// The tab bar's own href expression (BusabaseListToolbar in ../components/inbox.tsx).
// Kept here as a literal so this test fails loudly if the tab bar ever goes back
// to emitting a bare "/inbox" for the default tab.
const tabHref = (tab: InboxViewKey) => `/inbox?view=${tab}`;

const TABS: InboxViewKey[] = ["review", "changes", "created", "approved", "merged", "rejected"];

describe("readInboxView", () => {
  it("defaults to review when view is absent", () => {
    expect(readInboxView("")).toBe("review");
    expect(readInboxView("?foo=bar")).toBe("review");
  });

  it("defaults to review when view is unrecognized", () => {
    expect(readInboxView("?view=nonsense")).toBe("review");
  });

  it("round-trips every tab key, including the explicit review", () => {
    for (const tab of TABS) {
      expect(readInboxView(`?view=${tab}`)).toBe(tab);
    }
  });

  it("keeps plain /inbox bookmarks (no view param) on the review tab", () => {
    expect(readInboxView("?panel=open")).toBe("review");
  });
});

describe("inbox tab navigation through SPALink's query merge", () => {
  // The regression this file exists for: SPALink merges the CURRENT query
  // string into every href so unrelated params survive navigation. A tab whose
  // href omits `view` therefore inherits the view it is trying to leave — the
  // "For review" tab used to link to a bare "/inbox" and was consequently
  // unclickable from any other tab (it navigated to the URL already displayed).
  it("lands on the clicked tab no matter which tab is currently active", () => {
    for (const from of TABS) {
      const currentSearch = `?view=${from}`;
      for (const to of TABS) {
        const resolved = mergeSearchIntoHref(tabHref(to), currentSearch);
        expect(readInboxView(resolved.split("?")[1] ?? ""), `${from} -> ${to}`).toBe(to);
      }
    }
  });

  it("preserves unrelated query params while switching tabs", () => {
    const resolved = mergeSearchIntoHref(tabHref("review"), "?view=merged&demo=1");
    expect(readInboxView(resolved.split("?")[1] ?? "")).toBe("review");
    expect(new URLSearchParams(resolved.split("?")[1]).get("demo")).toBe("1");
  });

  it("a bare /inbox href cannot leave the active tab (why the fix was needed)", () => {
    // Documents the broken behavior so the reason for the explicit `view=review`
    // is not lost: this is what the old href produced.
    const resolved = mergeSearchIntoHref("/inbox", "?view=changes");
    expect(readInboxView(resolved.split("?")[1] ?? "")).toBe("changes");
  });
});
