import { describe, expect, it } from "vitest";
import {
  addDriveEntries,
  countDriveFolderFiles,
  driveEntryPath,
  driveFolderPaths,
  findDrivePathProblem,
  moveDriveEntry,
  moveDriveFolder,
  removeDriveEntry,
  removeDriveFolder,
  withDrivePaths,
  withoutDrivePaths,
} from "./drive-field-value";

const ref = (fileName: string, path?: string) => ({
  assetId: `ast_${fileName}`,
  attachmentId: `att_${fileName}`,
  url: `https://cdn.test/${fileName}`,
  fileName,
  mimeType: "application/pdf",
  size: 10,
  ...(path === undefined ? {} : { path }),
});

describe("driveEntryPath", () => {
  it("uses the stored path, and puts a ref without one at the root under its file name", () => {
    expect(driveEntryPath(ref("a.pdf", "contracts/a.pdf"))).toBe("contracts/a.pdf");
    expect(driveEntryPath(ref("a.pdf"))).toBe("a.pdf");
    expect(driveEntryPath(ref("a.pdf", ""))).toBe("a.pdf");
  });
});

describe("findDrivePathProblem", () => {
  it("accepts a sound tree, including plain attachment refs", () => {
    expect(
      findDrivePathProblem([
        ref("a.pdf", "contracts/2026/a.pdf"),
        ref("b.pdf"),
        ref("c.pdf", "c.pdf"),
      ]),
    ).toBeNull();
  });

  it("rejects paths the Drive node would reject", () => {
    for (const path of ["/abs.pdf", "a/../b.pdf", "a//b.pdf", "./a.pdf", "a/"]) {
      expect(findDrivePathProblem([ref("x.pdf", path)])).toEqual({ reason: "invalid", path });
    }
  });

  it("rejects two files at one path — including a pathless ref that lands on a taken root name", () => {
    expect(findDrivePathProblem([ref("a.pdf", "a.pdf"), ref("a.pdf")])).toEqual({
      reason: "duplicate",
      path: "a.pdf",
    });
  });

  it("rejects a file sitting where a folder is implied", () => {
    expect(findDrivePathProblem([ref("docs", "docs"), ref("a.pdf", "docs/a.pdf")])).toEqual({
      reason: "fileFolderClash",
      path: "docs",
    });
  });
});

describe("withDrivePaths / withoutDrivePaths (attachment ⇄ drive conversion)", () => {
  it("lands attachment files at the root and de-duplicates repeated names in order", () => {
    const converted = withDrivePaths([ref("a.pdf"), ref("a.pdf"), ref("a.pdf"), ref("notes")]);
    expect(converted.map((entry) => entry.path)).toEqual([
      "a.pdf",
      "a (2).pdf",
      "a (3).pdf",
      "notes",
    ]);
    // A de-duplicated file takes the name it is listed under, so the grid agrees with the tree.
    expect(converted.map((entry) => entry.fileName)).toEqual([
      "a.pdf",
      "a (2).pdf",
      "a (3).pdf",
      "notes",
    ]);
    // Every other ref field is preserved verbatim.
    expect(converted[0]).toMatchObject({
      assetId: "ast_a.pdf",
      size: 10,
      url: "https://cdn.test/a.pdf",
    });
  });

  it("drops the paths and nothing else on the way back", () => {
    const back = withoutDrivePaths([ref("a.pdf", "x/a.pdf")]);
    expect(back).toEqual([ref("a.pdf")]);
    expect("path" in (back[0] ?? {})).toBe(false);
  });
});

describe("addDriveEntries", () => {
  it("puts uploads in the chosen folder and never overwrites a file already there", () => {
    const next = addDriveEntries([ref("a.pdf", "inv/a.pdf")], [ref("a.pdf"), ref("b.pdf")], "inv");
    expect(next.map((entry) => entry.path)).toEqual(["inv/a.pdf", "inv/a (2).pdf", "inv/b.pdf"]);
    expect(next.map((entry) => entry.fileName)).toEqual(["a.pdf", "a (2).pdf", "b.pdf"]);
  });

  it("treats a sloppy folder string the way the Drive upload dialog does", () => {
    expect(addDriveEntries([], [ref("a.pdf")], " /2026//q1/ ").map((entry) => entry.path)).toEqual([
      "2026/q1/a.pdf",
    ]);
  });
});

describe("moveDriveEntry", () => {
  const cell = [ref("a.pdf", "a.pdf"), ref("b.pdf", "docs/b.pdf")];

  it("moves a file into a (possibly new) folder, keeping its name", () => {
    const result = moveDriveEntry(cell, "a.pdf", "2026/contracts/a.pdf");
    expect(result.ok && result.entries.map((entry) => entry.path)).toEqual([
      "2026/contracts/a.pdf",
      "docs/b.pdf",
    ]);
    expect(result.ok && result.entries[0]?.fileName).toBe("a.pdf");
  });

  it("renames fileName along with a new last segment, so every view shows the new name", () => {
    const result = moveDriveEntry(cell, "docs/b.pdf", "docs/invoice-11.pdf");
    expect(result.ok && result.entries[1]).toMatchObject({
      path: "docs/invoice-11.pdf",
      fileName: "invoice-11.pdf",
      assetId: "ast_b.pdf",
    });
  });

  it("refuses to overwrite, to accept an invalid path, or to move a file that is not there", () => {
    expect(moveDriveEntry(cell, "a.pdf", "docs/b.pdf")).toMatchObject({
      ok: false,
      reason: "conflict",
    });
    expect(moveDriveEntry(cell, "a.pdf", "../a.pdf")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(moveDriveEntry(cell, "a.pdf", "a.pdf")).toMatchObject({
      ok: false,
      reason: "unchanged",
    });
    expect(moveDriveEntry(cell, "zzz.pdf", "x.pdf")).toMatchObject({
      ok: false,
      reason: "missing",
    });
    // A file may not land where a folder is implied either.
    expect(moveDriveEntry(cell, "a.pdf", "docs")).toMatchObject({ ok: false, reason: "conflict" });
  });
});

describe("moveDriveFolder", () => {
  const cell = [ref("a.pdf", "docs/a.pdf"), ref("b.pdf", "docs/sub/b.pdf"), ref("c.pdf", "c.pdf")];

  it("renames a folder and carries its whole subtree", () => {
    const result = moveDriveFolder(cell, "docs", "archive/docs-2026");
    expect(result.ok && result.entries.map((entry) => entry.path)).toEqual([
      "archive/docs-2026/a.pdf",
      "archive/docs-2026/sub/b.pdf",
      "c.pdf",
    ]);
  });

  it("can flatten a folder into the root", () => {
    const result = moveDriveFolder([ref("a.pdf", "docs/a.pdf")], "docs", "");
    expect(result.ok && result.entries.map((entry) => entry.path)).toEqual(["a.pdf"]);
  });

  it("refuses collisions and moving a folder into itself", () => {
    expect(moveDriveFolder([...cell, ref("a.pdf", "x/a.pdf")], "docs", "x")).toMatchObject({
      ok: false,
      reason: "conflict",
      path: "x/a.pdf",
    });
    expect(moveDriveFolder(cell, "docs", "docs/sub")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(moveDriveFolder(cell, "nope", "x")).toMatchObject({ ok: false, reason: "missing" });
  });
});

describe("remove / list / count", () => {
  const cell = [ref("a.pdf", "docs/a.pdf"), ref("b.pdf", "docs/sub/b.pdf"), ref("c.pdf")];

  it("removes one file or a whole folder", () => {
    expect(removeDriveEntry(cell, "c.pdf").map((entry) => entry.path)).toEqual([
      "docs/a.pdf",
      "docs/sub/b.pdf",
    ]);
    expect(removeDriveFolder(cell, "docs").map((entry) => entry.path)).toEqual(["c.pdf"]);
    // A folder that only shares a name prefix is untouched.
    expect(removeDriveFolder([ref("a.pdf", "docs2/a.pdf")], "docs")).toHaveLength(1);
  });

  it("lists implied folders and counts files under a folder", () => {
    expect(driveFolderPaths(cell)).toEqual(["docs", "docs/sub"]);
    expect(countDriveFolderFiles(cell, "")).toBe(3);
    expect(countDriveFolderFiles(cell, "docs")).toBe(2);
    expect(countDriveFolderFiles(cell, "docs/sub")).toBe(1);
  });
});
