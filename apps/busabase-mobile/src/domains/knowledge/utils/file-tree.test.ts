import type { FileTreeFileVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { buildFileTreeListItems, getFolderForFile, getFolderItemCount } from "./file-tree";

const file = (path: string) =>
  ({
    path,
    size: 1,
    updatedAt: null,
    mimeType: null,
    assetId: null,
    displayName: null,
  }) as unknown as FileTreeFileVO;

/** What the screen lists while viewing `folder` — the controller's own filter. */
const listed = (paths: string[], folder: string) =>
  buildFileTreeListItems(paths.map(file))
    .filter((item) => getFolderForFile(item) === folder)
    .map((item) => `${item.type}:${item.path}`)
    .sort();

describe("which items a folder view lists", () => {
  const skill = ["SKILL.md", "skill.json", "scripts/collect.sh"];

  it("shows a top-level folder at the root, so the files inside it can be reached", () => {
    // The bug: a folder answered with its OWN path and so appeared only while
    // you were already inside it. `scripts/collect.sh` was unreachable.
    expect(listed(skill, "")).toEqual(["file:SKILL.md", "file:skill.json", "folder:scripts"]);
  });

  it("shows a folder's files once you are inside it", () => {
    expect(listed(skill, "scripts")).toEqual(["file:scripts/collect.sh"]);
  });

  it("shows a nested folder inside its parent, not inside itself", () => {
    const drive = ["README.md", "specs/2026/q3.md", "specs/overview.md"];
    expect(listed(drive, "")).toEqual(["file:README.md", "folder:specs"]);
    expect(listed(drive, "specs")).toEqual(["file:specs/overview.md", "folder:specs/2026"]);
    expect(listed(drive, "specs/2026")).toEqual(["file:specs/2026/q3.md"]);
  });

  it("counts a folder's direct children, not the folder itself", () => {
    const items = buildFileTreeListItems(["specs/2026/q3.md", "specs/overview.md"].map(file));
    expect(getFolderItemCount(items, "specs")).toBe(2); // overview.md + 2026/
    expect(getFolderItemCount(items, "specs/2026")).toBe(1);
  });
});
