import { describe, expect, it } from "vitest";
import { fieldDesignHref, fieldRecordsHref } from "./field-visibility-navigation";

describe("field creation navigation", () => {
  it("carries the source view to Design while preserving the workspace context", () => {
    expect(
      fieldDesignHref("tasks", "space=connected&originViewId=old&highlightField=old", "viw_tasks"),
    ).toBe("/base/tasks/design?space=connected&originViewId=viw_tasks");
  });

  it("does not carry another Base's creation intent into a source-less Design entry", () => {
    expect(fieldDesignHref("people", "demo=1&originViewId=old&highlightField=old")).toBe(
      "/base/people/design?demo=1",
    );
  });

  it("returns to the source view with the newly created field locator", () => {
    expect(
      fieldRecordsHref("tasks", "space=connected&originViewId=viw_tasks&highlightField=files", {
        slug: "review",
      }),
    ).toBe("/base/tasks/review?space=connected&highlightField=files");
    expect(fieldRecordsHref("tasks", "", null)).toBe("/base/tasks");
  });
});
