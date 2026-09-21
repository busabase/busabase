// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DocOutlineItem,
  DocTableOfContents,
  scrollToDocHeading,
  selectDocTocItems,
} from "./doc-table-of-contents";

afterEach(cleanup);

const outline: DocOutlineItem[] = [
  { id: "overview", level: 1, text: "Overview" },
  { id: "setup", level: 2, text: "Setup" },
  { id: "details", level: 3, text: "Details" },
  { id: "appendix", level: 4, text: "Appendix" },
];

describe("DocTableOfContents", () => {
  it("keeps H1-H3 only and requires enough heading structure", () => {
    expect(selectDocTocItems(outline).map((item) => item.id)).toEqual([
      "overview",
      "setup",
      "details",
    ]);
    expect(
      selectDocTocItems([
        { id: "one", level: 1, text: "One" },
        { id: "two", level: 1, text: "Two" },
      ]),
    ).toEqual([]);
    expect(
      selectDocTocItems([
        { id: "one", level: 1, text: "One" },
        { id: "two", level: 1, text: "Two" },
        { id: "three", level: 1, text: "Three" },
      ]),
    ).toEqual([]);
  });

  it("renders accessible navigation and reports the selected heading", () => {
    const onSelect = vi.fn();
    render(
      <DocTableOfContents
        activeId="setup"
        items={selectDocTocItems(outline)}
        label="On this page"
        onSelect={onSelect}
      />,
    );

    const navigation = screen.getByRole("navigation", { name: "On this page" });
    expect(navigation).toBeTruthy();
    expect(screen.getByRole("button", { name: "Setup" }).getAttribute("aria-current")).toBe(
      "location",
    );
    expect(screen.getByRole("button", { name: "Details" }).getAttribute("data-level")).toBe("3");

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(onSelect).toHaveBeenCalledWith("details");
  });

  it("scrolls the owning Doc container to the requested heading", () => {
    const container = document.createElement("div");
    const heading = document.createElement("h2");
    heading.id = "setup";
    container.append(heading);
    container.scrollTop = 40;
    container.scrollTo = vi.fn();
    container.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    heading.getBoundingClientRect = () => ({ top: 260 }) as DOMRect;

    expect(scrollToDocHeading(container, "setup")).toBe(true);
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 176, behavior: "smooth" });
    expect(scrollToDocHeading(container, "missing")).toBe(false);
  });
});
