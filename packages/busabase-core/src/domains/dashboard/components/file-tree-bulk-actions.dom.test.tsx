// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { fileTreeSelectionKey } from "../helpers/file-tree-bulk-actions";
import { buildFileTree, DriveFileTree, renderFileTree } from "./file-tree-browser";
import { FileTreeBulkRemoveDialog } from "./file-tree-file-actions";
import { SubmitPermissionProvider } from "./split-submit-button";

Object.assign(globalThis, { React });

const files = [
  {
    assetId: "asset-guide",
    displayName: "guide.md",
    mimeType: "text/markdown",
    name: "guide.md",
    path: "docs/guide.md",
    size: 20,
    updatedAt: null,
  },
  {
    assetId: "asset-logo",
    displayName: "logo.png",
    mimeType: "image/png",
    name: "logo.png",
    path: "docs/images/logo.png",
    size: 30,
    updatedAt: null,
  },
];

afterEach(cleanup);

describe("Drive bulk action controls", () => {
  it("renders file and folder checkboxes and identifies their selection kind", () => {
    const onToggleSelection = vi.fn();
    render(
      <CoreI18nProvider locale="en">
        <DriveFileTree
          defaultExpanded={new Set(["docs", "docs/images"])}
          onToggleSelection={onToggleSelection}
          selectedKeys={new Set([fileTreeSelectionKey("folder", "docs")])}
          selectionMode
        >
          {renderFileTree(buildFileTree(files))}
        </DriveFileTree>
      </CoreI18nProvider>,
    );

    const folder = screen.getByRole("checkbox", { name: "Select docs" });
    const file = screen.getByRole("checkbox", { name: "Select guide.md" });
    expect(folder.getAttribute("data-state")).toBe("checked");
    expect(file.getAttribute("data-state")).toBe("unchecked");

    fireEvent.click(file);
    expect(onToggleSelection).toHaveBeenCalledWith("file", "docs/guide.md");
    fireEvent.click(folder);
    expect(onToggleSelection).toHaveBeenCalledWith("folder", "docs");
  });

  it("states the exact affected file count and keeps changeRequest-only submit semantics", () => {
    render(
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel="changeRequest">
          <FileTreeBulkRemoveDialog
            fileCount={1}
            label="docs"
            onOpenChange={vi.fn()}
            onSubmit={vi.fn()}
            open
          />
        </SubmitPermissionProvider>
      </CoreI18nProvider>,
    );

    expect(
      screen.getByText("This removes 1 file from this Drive after the change is merged."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request removal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove now" })).toBeNull();
  });
});
