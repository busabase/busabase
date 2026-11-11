import type { BaseFieldVO, FieldType } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  defaultNewFieldValue,
  getAttachmentRefs,
  getEditorFieldValue,
  getFieldPreviewText,
  isRecordLongField,
  normalizeEditorFieldValue,
} from "./field";

/**
 * The `drive` branches of the shared field helpers. A drive cell is an
 * attachment ref array whose refs also carry a `path`; the one way to lose a
 * user's folders is a helper that reads the refs and drops that key on the way
 * back out, so most of this file pins that `path` survives.
 */

const field = (type: FieldType): BaseFieldVO =>
  ({
    id: `f_${type}`,
    baseId: "b1",
    slug: type,
    name: type,
    type,
    required: false,
    position: 0,
    options: {},
  }) as BaseFieldVO;

const ref = (id: string, fileName: string, path?: unknown) => ({
  id,
  assetId: id,
  url: `https://cdn/${id}`,
  fileName,
  mimeType: "application/pdf",
  size: 7,
  ...(path === undefined ? {} : { path }),
});

describe("getAttachmentRefs keeps a drive ref's path", () => {
  it("keeps a string path and adds none where there was none", () => {
    const refs = getAttachmentRefs([ref("a", "main.pdf", "contracts/main.pdf"), ref("b", "x.pdf")]);
    expect(refs[0]?.path).toBe("contracts/main.pdf");
    expect(refs[1]).not.toHaveProperty("path");
  });

  it("ignores a path that is not a string", () => {
    expect(getAttachmentRefs([ref("a", "main.pdf", 42)])[0]).not.toHaveProperty("path");
  });
});

describe("drive field values in the record editor", () => {
  const stored = [
    ref("a", "main.pdf", "contracts/main.pdf"),
    // Written by an API caller that only knows attachment refs.
    ref("b", "notes.txt"),
    // Same root name as the ref above: it must not overwrite it.
    ref("c", "notes.txt"),
    { junk: true },
  ];

  it("opens with every ref given an explicit, unique path", () => {
    expect(
      (getEditorFieldValue(field("drive"), stored) as Array<{ id: string; path: string }>).map(
        (entry) => [entry.id, entry.path],
      ),
    ).toEqual([
      ["a", "contracts/main.pdf"],
      ["b", "notes.txt"],
      ["c", "notes (2).txt"],
    ]);
  });

  it("saves the same shape, so a round trip keeps the folders", () => {
    const opened = getEditorFieldValue(field("drive"), stored);
    expect(normalizeEditorFieldValue(field("drive"), opened)).toEqual(opened);
    expect(normalizeEditorFieldValue(field("drive"), "")).toEqual([]);
    expect(normalizeEditorFieldValue(field("drive"), undefined)).toEqual([]);
  });

  it("starts a new record the way an attachment field does", () => {
    expect(defaultNewFieldValue("drive")).toEqual(defaultNewFieldValue("attachment"));
    expect(getEditorFieldValue(field("drive"), defaultNewFieldValue("drive"))).toEqual([]);
  });

  it("leaves attachment values without a path", () => {
    const opened = getEditorFieldValue(field("attachment"), [ref("b", "x.pdf")]);
    expect((opened as object[])[0]).not.toHaveProperty("path");
  });
});

describe("drive field text and layout", () => {
  it("reads as the paths of its files", () => {
    expect(
      getFieldPreviewText(field("drive"), [
        ref("a", "main.pdf", "contracts/main.pdf"),
        ref("b", "x.pdf"),
      ]),
    ).toBe("contracts/main.pdf, x.pdf");
    expect(getFieldPreviewText(field("drive"), [])).toBe("");
    // An attachment column still reads as file names.
    expect(
      getFieldPreviewText(field("attachment"), [ref("a", "main.pdf", "contracts/main.pdf")]),
    ).toBe("main.pdf");
  });

  it("gets the record page's full-width section", () => {
    expect(isRecordLongField(field("drive"))).toBe(true);
    expect(isRecordLongField(field("attachment"))).toBe(false);
  });
});
