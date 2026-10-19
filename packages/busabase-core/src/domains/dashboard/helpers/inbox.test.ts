import { mergeSearchIntoHref } from "openlib/ui/dashboard";
import { describe, expect, it } from "vitest";
import {
  type InboxViewKey,
  inboxNeighborPage,
  readInboxQueueContext,
  readInboxView,
  writeInboxQueueContext,
} from "./inbox";

const tabHref = (tab: InboxViewKey) => `/inbox?view=${tab}&inboxPage=1`;
const TABS: InboxViewKey[] = ["review", "changes", "created", "approved", "merged", "rejected"];

describe("readInboxView", () => {
  it("defaults to review for absent or unknown values", () => {
    expect(readInboxView("")).toBe("review");
    expect(readInboxView("?view=nonsense")).toBe("review");
  });

  it("round-trips every tab key", () => {
    for (const tab of TABS) expect(readInboxView(`?view=${tab}`)).toBe(tab);
  });

  it("keeps plain /inbox bookmarks on the review tab", () => {
    expect(readInboxView("?panel=open")).toBe("review");
  });
});

describe("inbox tab navigation through SPALink's query merge", () => {
  it("lands on the clicked tab and resets its page", () => {
    for (const from of TABS) {
      for (const to of TABS) {
        const resolved = mergeSearchIntoHref(tabHref(to), `?view=${from}&inboxPage=4`);
        const search = resolved.split("?")[1] ?? "";
        expect(readInboxView(search), `${from} -> ${to}`).toBe(to);
        expect(new URLSearchParams(search).get("inboxPage")).toBe("1");
      }
    }
  });

  it("preserves unrelated query params while switching tabs", () => {
    const resolved = mergeSearchIntoHref(tabHref("review"), "?view=merged&demo=1");
    expect(readInboxView(resolved.split("?")[1] ?? "")).toBe("review");
    expect(new URLSearchParams(resolved.split("?")[1]).get("demo")).toBe("1");
  });

  it("documents why a bare /inbox href cannot leave the active tab", () => {
    const resolved = mergeSearchIntoHref("/inbox", "?view=changes");
    expect(readInboxView(resolved.split("?")[1] ?? "")).toBe("changes");
  });
});

describe("inbox queue context", () => {
  it("round-trips the selected tab and page without dropping unrelated search state", () => {
    const search = writeInboxQueueContext("space=remote&lang=zh-CN", {
      view: "review",
      page: 3,
      pageSize: 25,
    });
    expect(readInboxQueueContext(search)).toEqual({ view: "review", page: 3, pageSize: 25 });
    expect(new URLSearchParams(search).get("space")).toBe("remote");
    expect(new URLSearchParams(search).get("lang")).toBe("zh-CN");
  });

  it("does not treat a direct link or malformed paging data as a queue", () => {
    expect(readInboxQueueContext("view=review")).toBeNull();
    expect(readInboxQueueContext("view=review&inboxPage=0&inboxPageSize=50")).toBeNull();
    expect(readInboxQueueContext("view=review&inboxPage=1&inboxPageSize=500")).toBeNull();
    expect(readInboxQueueContext("view=unknown&inboxPage=1&inboxPageSize=50")).toBeNull();
  });
});

describe("inbox queue neighbors", () => {
  it("uses the displayed order within a page", () => {
    expect(inboxNeighborPage(["new", "middle", "old"], "middle", "previous", 2, 4)).toEqual({
      id: "new",
      page: 2,
    });
    expect(inboxNeighborPage(["new", "middle", "old"], "middle", "next", 2, 4)).toEqual({
      id: "old",
      page: 2,
    });
  });

  it("points to an adjacent page only at a page boundary", () => {
    expect(inboxNeighborPage(["first", "last"], "last", "next", 2, 4)).toEqual({ page: 3 });
    expect(inboxNeighborPage(["first", "last"], "first", "previous", 2, 4)).toEqual({
      page: 1,
    });
    expect(inboxNeighborPage(["first", "last"], "last", "next", 4, 4)).toBeNull();
    expect(inboxNeighborPage(["first", "last"], "missing", "next", 2, 4)).toBeNull();
  });
});
