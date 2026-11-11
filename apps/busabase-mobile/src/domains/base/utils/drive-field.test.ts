import { describe, expect, it } from "vitest";
import { en } from "~/i18n/messages";
import {
  buildDriveListItems,
  createDriveFolder,
  type DriveRef,
  type DriveView,
  deleteDriveFolder,
  describeDriveEditFailure,
  formatDriveFileCount,
  isPendingDriveFolder,
  listDriveFolder,
  renameDriveFile,
  renameDriveFolder,
  toDriveListFile,
} from "./drive-field";

const entry = (path: string, overrides: Partial<DriveRef> = {}): DriveRef => ({
  id: path,
  assetId: `asset-${path}`,
  attachmentId: `att-${path}`,
  url: `/api/storage/${path}`,
  fileName: path.split("/").at(-1) ?? path,
  mimeType: "application/pdf",
  size: 2048,
  path,
  ...overrides,
});

const view = (paths: string[], folder = ""): DriveView => ({
  entries: paths.map((p) => entry(p)),
  folder,
});

/** What the editor lists while viewing `folder`. */
const listed = (current: DriveView) =>
  listDriveFolder(buildDriveListItems(current), current.folder).map(
    (item) => `${item.type}:${item.path}`,
  );

const paths = (current: DriveView) => current.entries.map((item) => item.path);

describe("drive entries as the Drive node's folder list", () => {
  const cell = ["contracts/2026/main.pdf", "contracts/nda.pdf", "readme.pdf"];

  it("lists the folders a cell's paths imply, folders first, at each level", () => {
    expect(listed(view(cell))).toEqual(["folder:contracts", "file:readme.pdf"]);
    expect(listed(view(cell, "contracts"))).toEqual([
      "folder:contracts/2026",
      "file:contracts/nda.pdf",
    ]);
    expect(listed(view(cell, "contracts/2026"))).toEqual(["file:contracts/2026/main.pdf"]);
  });

  it("maps a ref to a list file named after the last part of its path", () => {
    const file = toDriveListFile(entry("contracts/2026/main.pdf", { size: 10 }));
    expect(file).toMatchObject({
      path: "contracts/2026/main.pdf",
      name: "main.pdf",
      size: 10,
      mimeType: "application/pdf",
      assetId: "asset-contracts/2026/main.pdf",
    });
  });

  it("falls back to the attachment id when a ref carries no asset id", () => {
    expect(toDriveListFile(entry("a.pdf", { assetId: undefined })).assetId).toBe("att-a.pdf");
  });

  it("lists a new, still-empty folder only while you are in it", () => {
    // In it: it and its parents show, so "up" leads somewhere sensible.
    expect(listed(view(cell, "contracts/2027"))).toEqual([]);
    expect(listed({ ...view(cell, "contracts/2027"), folder: "contracts" })).toEqual([
      "folder:contracts/2026",
      "file:contracts/nda.pdf",
    ]);
    const items = buildDriveListItems(view(cell, "contracts/2027"));
    expect(listDriveFolder(items, "contracts").map((item) => item.path)).toContain(
      "contracts/2027",
    );
    expect(isPendingDriveFolder(view(cell, "contracts/2027"))).toBe(true);
    expect(isPendingDriveFolder(view(cell, "contracts"))).toBe(false);
    expect(isPendingDriveFolder(view(cell, ""))).toBe(false);
  });
});

describe("organising a drive cell", () => {
  it("opens a new folder inside the current one without writing anything", () => {
    const current = view(["a.pdf"], "contracts");
    const result = createDriveFolder(current, "  2026 ");
    expect(result).toEqual({
      ok: true,
      view: { entries: current.entries, folder: "contracts/2026" },
    });
  });

  it("refuses a folder name with a slash, an empty name, or a file's name", () => {
    expect(createDriveFolder(view([]), "a/b")).toEqual({ ok: false, reason: "invalid" });
    expect(createDriveFolder(view([]), "  ")).toEqual({ ok: false, reason: "invalid" });
    expect(createDriveFolder(view([]), "x".repeat(256))).toEqual({ ok: false, reason: "tooLong" });
    expect(createDriveFolder(view(["deals/x.pdf"], "deals"), "x.pdf")).toEqual({
      ok: false,
      reason: "fileExists",
      path: "deals/x.pdf",
    });
  });

  it("renames or moves a file by its full path", () => {
    const result = renameDriveFile(view(["main.pdf", "b.pdf"]), "main.pdf", "/contracts/main.pdf/");
    expect(result.ok).toBe(true);
    if (result.ok === true) expect(paths(result.view)).toEqual(["contracts/main.pdf", "b.pdf"]);
  });

  it("refuses to move a file onto another instead of overwriting it", () => {
    expect(renameDriveFile(view(["a.pdf", "b.pdf"]), "a.pdf", "b.pdf")).toEqual({
      ok: false,
      reason: "conflict",
      path: "b.pdf",
    });
    expect(renameDriveFile(view(["a.pdf"]), "a.pdf", "a.pdf")).toEqual({ ok: "unchanged" });
    expect(renameDriveFile(view(["a.pdf"]), "a.pdf", "x/../a.pdf")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("moves a folder with everything in it and keeps the viewer inside it", () => {
    const current = view(["deals/2026/x.pdf", "deals/y.pdf", "z.pdf"], "deals/2026");
    const result = renameDriveFolder(current, "deals", "archive/deals");
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(paths(result.view)).toEqual([
        "archive/deals/2026/x.pdf",
        "archive/deals/y.pdf",
        "z.pdf",
      ]);
      expect(result.view.folder).toBe("archive/deals/2026");
    }
  });

  it("refuses to move a folder into itself or onto a file", () => {
    const current = view(["deals/x.pdf", "deals.pdf"]);
    expect(renameDriveFolder(current, "deals", "deals/old")).toMatchObject({
      ok: false,
      reason: "intoItself",
    });
    expect(renameDriveFolder(current, "deals", "deals.pdf")).toMatchObject({
      ok: false,
      reason: "conflict",
    });
  });

  it("renames a still-empty new folder by moving the viewer only", () => {
    const current = view(["a.pdf"], "drafts");
    expect(renameDriveFolder(current, "drafts", "final")).toEqual({
      ok: true,
      view: { entries: current.entries, folder: "final" },
    });
    expect(renameDriveFolder(current, "drafts", "a.pdf")).toMatchObject({
      ok: false,
      reason: "conflict",
      path: "a.pdf",
    });
    expect(renameDriveFolder(current, "drafts", "")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("removes a folder and its files, stepping a viewer inside it out to the parent", () => {
    const current = view(["deals/2026/x.pdf", "deals/y.pdf", "z.pdf"], "deals/2026");
    expect(deleteDriveFolder(current, "deals/2026")).toMatchObject({ folder: "deals" });
    const removed = deleteDriveFolder(current, "deals");
    expect(paths(removed)).toEqual(["z.pdf"]);
    expect(removed.folder).toBe("");
    expect(deleteDriveFolder(view(["a/x.pdf", "b/y.pdf"], "b"), "a").folder).toBe("b");
  });
});

describe("what the user is told", () => {
  const messages = en.driveField;

  it("explains each refusal in words", () => {
    expect(describeDriveEditFailure({ reason: "conflict", path: "b.pdf" }, messages)).toBe(
      'Something is already at "b.pdf". Choose another name.',
    );
    expect(describeDriveEditFailure({ reason: "invalid", path: "a//b" }, messages)).toContain(
      '"a//b" is not a valid path',
    );
    expect(describeDriveEditFailure({ reason: "invalid", path: "" }, messages)).toBe(
      messages.pathRequired,
    );
    expect(describeDriveEditFailure({ reason: "invalid" }, messages)).toBe(messages.invalidName);
    expect(describeDriveEditFailure({ reason: "intoItself" }, messages)).toBe(messages.intoItself);
  });

  it("counts files in the user's language", () => {
    expect(formatDriveFileCount(1, messages)).toBe("1 file");
    expect(formatDriveFileCount(3, messages)).toBe("3 files");
  });
});
