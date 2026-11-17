import { describe, expect, it } from "vitest";
import {
  baseCrumbHref,
  readSourceViewSlug,
  resolveCarriedViewSlug,
  withSourceView,
} from "./source-view-url";

const views = [{ slug: "board" }, { slug: "grid-view" }];

describe("source view on record URLs", () => {
  it("reads fromView and ignores a blank value", () => {
    expect(readSourceViewSlug("?fromView=board&space=tnl_1")).toBe("board");
    expect(readSourceViewSlug("fromView=%20")).toBeNull();
    expect(readSourceViewSlug("view=board")).toBeNull();
  });

  it("keeps the slug only while it names an active view", () => {
    expect(resolveCarriedViewSlug("fromView=board", views)).toBe("board");
    expect(resolveCarriedViewSlug("fromView=archived", views)).toBeNull();
    expect(resolveCarriedViewSlug("", views)).toBeNull();
  });

  it("points the Base crumb at that view, or at the bare Base when there is none", () => {
    expect(baseCrumbHref("tasks", "board")).toBe("/base/tasks/board");
    expect(baseCrumbHref("tasks", null)).toBe("/base/tasks");
  });

  it("adds fromView to a record path without dropping a query the path already has", () => {
    expect(withSourceView("/base/tasks/rec_1", "board")).toBe("/base/tasks/rec_1?fromView=board");
    expect(withSourceView("/base/tasks/rec_1/edit?space=tnl_1", "board")).toBe(
      "/base/tasks/rec_1/edit?space=tnl_1&fromView=board",
    );
    expect(withSourceView("/base/tasks/new", null)).toBe("/base/tasks/new");
  });
});
