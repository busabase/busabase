// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

Object.assign(globalThis, { React });

// jsdom has no layout, so hand the windowed branch a fixed window; browser
// acceptance covers real scrolling.
const scrollToIndex = vi.fn();
let windowIndexes = [0, 1, 2];
const virtualizerOptions: {
  current?: { rangeExtractor: (range: unknown) => number[] };
} = {};
vi.mock("@tanstack/react-virtual", () => ({
  defaultRangeExtractor: () => windowIndexes,
  useVirtualizer: (options: { count: number; rangeExtractor: (range: unknown) => number[] }) => {
    virtualizerOptions.current = options;
    return {
      getTotalSize: () => options.count * 32,
      getVirtualItems: () =>
        options.rangeExtractor({}).map((index) => ({ index, start: index * 32 })),
      measureElement: () => undefined,
      scrollToIndex,
    };
  },
}));

const { buildFileTree, DriveFileTree, FileTreeRows, flattenFileTree } = await import(
  "./file-tree-browser"
);

const file = (path: string) => ({
  assetId: path,
  displayName: path,
  mimeType: "text/plain",
  name: path,
  path,
  size: 1,
  updatedAt: null,
});

const paths = (rows: ReturnType<typeof flattenFileTree>) => rows.map((row) => row.key);

const renderRows = (
  files: ReturnType<typeof file>[],
  props: { expanded?: Set<string>; onSelect?: (path: string) => void; selectedPath?: string } = {},
) => {
  return render(
    <CoreI18nProvider locale="en">
      <DriveFileTree
        expanded={props.expanded ?? new Set()}
        onSelect={props.onSelect}
        selectedPath={props.selectedPath}
      >
        <FileTreeRows scrollElement={document.createElement("div")} tree={buildFileTree(files)} />
      </DriveFileTree>
    </CoreI18nProvider>,
  );
};

beforeEach(() => {
  scrollToIndex.mockClear();
  windowIndexes = [0, 1, 2];
});
afterEach(cleanup);

describe("flattenFileTree", () => {
  const tree = buildFileTree([file("docs/images/logo.png"), file("docs/guide.md"), file("a.md")]);

  it("omits everything under a collapsed folder", () => {
    expect(paths(flattenFileTree(tree, new Set()))).toEqual(["docs", "a.md"]);
  });

  it("lists expanded folders in tree order with their depth and sibling position", () => {
    const rows = flattenFileTree(tree, new Set(["docs", "docs/images"]));
    expect(paths(rows)).toEqual([
      "docs",
      "docs/images",
      "docs/images/logo.png",
      "docs/guide.md",
      "a.md",
    ]);
    expect(rows[3]).toMatchObject({ depth: 1, posInSet: 2, setSize: 2 });
  });

  it("keeps a collapsed subtree's expansion from leaking through its parent", () => {
    expect(paths(flattenFileTree(tree, new Set(["docs/images"])))).toEqual(["docs", "a.md"]);
  });

  it("adds a footer only where one has content, after the folder's children and at the root", () => {
    const rows = flattenFileTree(tree, new Set(["docs"]), (folder) =>
      folder === "docs" || folder === "" ? "load more" : null,
    );
    expect(paths(rows)).toEqual([
      "docs",
      "docs/images",
      "docs/guide.md",
      "docs\0footer",
      "a.md",
      "\0footer",
    ]);
  });

  it("asks for no footer on a collapsed folder", () => {
    const footer = vi.fn((_folder: string) => null);
    flattenFileTree(tree, new Set(), footer);
    expect(footer.mock.calls.map(([folder]) => folder)).toEqual([""]);
  });
});

describe("FileTreeRows", () => {
  it("mounts every row of a small tree, exposes its level, and selects on click", () => {
    const onSelect = vi.fn();
    renderRows([file("docs/guide.md"), file("a.md")], { expanded: new Set(["docs"]), onSelect });
    expect(screen.getAllByRole("treeitem")).toHaveLength(3);
    const guide = screen.getByRole("treeitem", { name: "guide.md" });
    expect(guide.getAttribute("aria-level")).toBe("2");
    expect(guide.getAttribute("aria-posinset")).toBe("1");
    fireEvent.click(guide);
    expect(onSelect).toHaveBeenCalledWith("docs/guide.md");
    expect(screen.getByRole("treeitem", { name: "docs" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("mounts only the window of a large tree and scrolls to the selected row", () => {
    const files = Array.from({ length: 101 }, (_, index) =>
      file(`f-${String(index).padStart(3, "0")}.md`),
    );
    renderRows(files, { selectedPath: "f-050.md" });
    expect(screen.getAllByRole("treeitem")).toHaveLength(3);
    expect(scrollToIndex).toHaveBeenCalledWith(50, { align: "auto" });
  });

  it("keeps the focused row mounted once it leaves the window, until focus moves away", () => {
    const files = Array.from({ length: 101 }, (_, index) =>
      file(`f-${String(index).padStart(3, "0")}.md`),
    );
    renderRows(files);
    fireEvent.focus(screen.getByRole("treeitem", { name: "f-000.md" }));

    windowIndexes = [50, 51, 52];
    expect(virtualizerOptions.current?.rangeExtractor({})).toEqual([0, 50, 51, 52]);

    fireEvent.blur(screen.getByRole("treeitem", { name: "f-000.md" }));
    expect(virtualizerOptions.current?.rangeExtractor({})).toEqual([50, 51, 52]);
  });

  it("does not window or scroll at the threshold", () => {
    const files = Array.from({ length: 100 }, (_, index) =>
      file(`f-${String(index).padStart(3, "0")}.md`),
    );
    renderRows(files, { selectedPath: "f-050.md" });
    expect(screen.getAllByRole("treeitem")).toHaveLength(100);
    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});
