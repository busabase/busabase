import { describe, expect, it } from "vitest";
import { libarchiveEntries, withImpliedFolders } from "./ArchiveViewer";

describe("libarchiveEntries", () => {
  it("joins each file's folder path with its own name", () => {
    // The shape libarchive.js' getFilesArray() returns for a tar.gz with
    // README.txt, brief/agency-brief-demo.md and data/agencies.csv.
    const entries = libarchiveEntries([
      { file: { name: "README.txt", size: 35 }, path: "" },
      { file: { name: "agency-brief-demo.md", size: 22 }, path: "brief/" },
      { file: { name: "agencies.csv", size: 36 }, path: "data/" },
    ]);

    expect(entries).toEqual([
      { filename: "README.txt", directory: false, uncompressedSize: 35 },
      { filename: "brief/agency-brief-demo.md", directory: false, uncompressedSize: 22 },
      { filename: "data/agencies.csv", directory: false, uncompressedSize: 36 },
    ]);
  });

  it("keeps entries libarchive could not extract, named by their key", () => {
    expect(libarchiveEntries([{ file: "locked.bin", path: "secret/" }])).toEqual([
      { filename: "secret/locked.bin", directory: false, uncompressedSize: undefined },
    ]);
  });
});

describe("withImpliedFolders", () => {
  it("adds the folders an archive only implies, before their first file", () => {
    expect(
      withImpliedFolders([
        { filename: "brief/agency-brief-demo.md", directory: false },
        { filename: "data/2026/agencies.csv", directory: false },
        { filename: "README.txt", directory: false },
      ]).map((e) => e.filename),
    ).toEqual([
      "brief/",
      "brief/agency-brief-demo.md",
      "data/",
      "data/2026/",
      "data/2026/agencies.csv",
      "README.txt",
    ]);
  });

  it("does not repeat folders the archive lists itself", () => {
    expect(
      withImpliedFolders([
        { filename: "brief/", directory: true },
        { filename: "brief/agency-brief-demo.md", directory: false },
      ]).map((e) => e.filename),
    ).toEqual(["brief/", "brief/agency-brief-demo.md"]);
  });
});
