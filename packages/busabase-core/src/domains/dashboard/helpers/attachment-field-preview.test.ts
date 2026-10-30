import type { BaseFieldVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { getAttachmentRefs, getFieldPreviewText, getSafeAttachmentUrl } from "./field";

const field: BaseFieldVO = {
  id: "files",
  baseId: "base",
  slug: "files",
  name: "Files",
  type: "attachment",
  position: 1,
  required: false,
  options: {},
};
const legacy = {
  id: "old",
  url: "https://example.com/old.png",
  fileName: "旧图片.png",
  mimeType: "image/png",
  size: 123,
};

describe("attachment textual projection", () => {
  it("summarizes filenames without exposing storage identifiers or JSON", () => {
    const refs = [legacy, { ...legacy, id: "new", fileName: "成绩单.pdf" }];
    expect(getFieldPreviewText(field, refs)).toBe("旧图片.png, 成绩单.pdf");
    expect(getFieldPreviewText(field, [])).toBe("");
    expect(getFieldPreviewText(field, [null, 42, {}])).toBe("");
  });

  it("does not change real JSON fields into attachment summaries", () => {
    expect(getFieldPreviewText({ ...field, type: "json" }, [legacy])).toBe(
      JSON.stringify([legacy], null, 2),
    );
  });

  it("supports legacy attachment IDs and durable asset references together", () => {
    const refs = getAttachmentRefs([
      legacy,
      { ...legacy, id: undefined, assetId: "ast_current" },
      { ...legacy, id: undefined, attachmentId: "att_legacy" },
    ]);
    expect(refs.map((ref) => ref.id)).toEqual(["old", "ast_current", "att_legacy"]);
    expect(refs.map(getSafeAttachmentUrl)).toEqual([
      legacy.url,
      "/api/assets/ast_current/raw",
      legacy.url,
    ]);
  });

  it("rejects unsafe legacy protocols and escapes an asset identifier as a path segment", () => {
    expect(getSafeAttachmentUrl({ ...legacy, url: "javascript:alert(1)" })).toBeNull();
    expect(getSafeAttachmentUrl({ ...legacy, assetId: "ast_a/b" })).toBe(
      "/api/assets/ast_a%2Fb/raw",
    );
  });
});
