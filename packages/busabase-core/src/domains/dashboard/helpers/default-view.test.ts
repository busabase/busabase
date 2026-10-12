import { describe, expect, it } from "vitest";
import { ALL_RECORDS_CHILD_ID, resolveDefaultViewPath } from "./default-view";

const views = [{ slug: "board" }, { slug: "calendar" }];

describe("resolveDefaultViewPath", () => {
  it("points the bare Base route at the default view", () => {
    expect(resolveDefaultViewPath({ baseSlug: "tasks", defaultViewSlug: "board", views })).toBe(
      "/base/tasks/board",
    );
  });

  it("stays on the grid when no default is set", () => {
    expect(resolveDefaultViewPath({ baseSlug: "tasks", defaultViewSlug: null, views })).toBeNull();
    expect(
      resolveDefaultViewPath({ baseSlug: "tasks", defaultViewSlug: undefined, views }),
    ).toBeNull();
  });

  it("ignores a slug that no active view carries", () => {
    expect(
      resolveDefaultViewPath({ baseSlug: "tasks", defaultViewSlug: "gone", views }),
    ).toBeNull();
  });

  it("never redirects to the reserved all-records child id", () => {
    expect(
      resolveDefaultViewPath({
        baseSlug: "tasks",
        defaultViewSlug: ALL_RECORDS_CHILD_ID,
        views: [...views, { slug: ALL_RECORDS_CHILD_ID }],
      }),
    ).toBeNull();
  });
});
