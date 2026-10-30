// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { fieldDesignHref, fieldRecordsHref } from "../helpers/field-visibility-navigation";
import { FieldContextLink } from "./field-context-link";

afterEach(cleanup);

describe("field navigation links", () => {
  it("does not restore a consumed highlight when entering Design", () => {
    const location = memoryLocation({ path: "/base/tasks/review", record: true });
    render(
      <Router hook={location.hook}>
        <FieldContextLink
          href={fieldDesignHref("tasks", "space=connected&highlightField=old", "viw_review")}
        >
          Design
        </FieldContextLink>
      </Router>,
    );
    const link = screen.getByRole("link", { name: "Design" });
    expect(link.getAttribute("href")).toBe(
      "/base/tasks/design?space=connected&originViewId=viw_review",
    );
    fireEvent.click(link);
    expect(location.history.at(-1)).toBe(
      "/base/tasks/design?space=connected&originViewId=viw_review",
    );
  });

  it("returns to the originating view without carrying its edit-only origin parameter", () => {
    const location = memoryLocation({ path: "/base/tasks/design", record: true });
    render(
      <Router hook={location.hook}>
        <FieldContextLink
          href={fieldRecordsHref(
            "tasks",
            "space=connected&originViewId=viw_review&highlightField=files",
            { slug: "review" },
          )}
        >
          Records
        </FieldContextLink>
      </Router>,
    );
    expect(screen.getByRole("link", { name: "Records" }).getAttribute("href")).toBe(
      "/base/tasks/review?space=connected&highlightField=files",
    );
  });
});
