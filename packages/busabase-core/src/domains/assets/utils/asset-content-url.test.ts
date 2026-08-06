import { describe, expect, it } from "vitest";
import {
  buildAssetContentUrl,
  extractAssetContentIds,
  rewriteAssetContentIds,
} from "./asset-content-url";

describe("asset content URL", () => {
  it("builds the stable route for an asset id", () => {
    expect(buildAssetContentUrl("astabc123")).toBe("/api/assets/astabc123/raw");
  });

  it("extracts ids from markdown image embeds", () => {
    const body =
      "# Spec\n\n![1.00](/api/assets/astaaa/raw)\n\ntext\n\n![](/api/assets/astbbb/raw)\n";
    expect(extractAssetContentIds(body)).toEqual(["astaaa", "astbbb"]);
  });

  it("dedupes repeats and keeps first-seen order", () => {
    const body =
      "![](/api/assets/astbbb/raw) ![](/api/assets/astaaa/raw) ![](/api/assets/astbbb/raw)";
    expect(extractAssetContentIds(body)).toEqual(["astbbb", "astaaa"]);
  });

  it("recognizes an absolute-origin form as well as a root-relative one", () => {
    expect(extractAssetContentIds("<img src='https://example.com/api/assets/astzzz/raw'>")).toEqual(
      ["astzzz"],
    );
  });

  it("ignores a legacy storage URL and the JSON content API", () => {
    const body =
      "![](/api/storage/attachments/2026/deadbeef.png)\n![](/api/dev/attachment/x/y.png)\n" +
      "[meta](/api/v1/assets/astaaa/content)\n";
    expect(extractAssetContentIds(body)).toEqual([]);
  });

  it("rewrites only the ids present in the map, byte-for-byte elsewhere", () => {
    const body = "![a](/api/assets/astold/raw) ![b](/api/assets/astkeep/raw)";
    const rewritten = rewriteAssetContentIds(body, new Map([["astold", "astnew"]]));
    expect(rewritten).toBe("![a](/api/assets/astnew/raw) ![b](/api/assets/astkeep/raw)");
  });

  it("is a no-op for an empty map", () => {
    const body = "![a](/api/assets/astold/raw)";
    expect(rewriteAssetContentIds(body, new Map())).toBe(body);
  });
});
