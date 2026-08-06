import { describe, expect, it } from "vitest";
import {
  collectDocAssetIds,
  docAssetBytesPath,
  extractDocAssetIds,
  reportUnresolvableDocAssets,
  rewriteDocAssetIds,
} from "./doc-asset-refs";
import type { PackageNode } from "./tree";

const doc = (slug: string, body: string): PackageNode => ({
  type: "doc",
  slug,
  name: slug,
  description: "",
  position: 0,
  body,
});

describe("doc asset references", () => {
  it("extracts the asset ids a doc body embeds, deduped and in order", () => {
    const body =
      "![1.00](/api/assets/astbbb/raw)\n![](/api/assets/astaaa/raw)\n![](/api/assets/astbbb/raw)";
    expect(extractDocAssetIds(body)).toEqual(["astbbb", "astaaa"]);
  });

  it("ignores legacy storage URLs (nothing to rewrite, nothing to warn about)", () => {
    expect(extractDocAssetIds("![](/api/storage/attachments/blobs/sha256/aa/bb.png)")).toEqual([]);
  });

  it("collects across the whole tree, including nested folders, deduped", () => {
    const nodes: PackageNode[] = [
      doc("a", "![](/api/assets/astaaa/raw)"),
      {
        type: "folder",
        slug: "guides",
        name: "Guides",
        description: "",
        position: 1,
        children: [doc("b", "![](/api/assets/astbbb/raw) ![](/api/assets/astaaa/raw)")],
      },
    ];
    expect(collectDocAssetIds(nodes)).toEqual(["astaaa", "astbbb"]);
  });

  it("names the bytes by asset id, keeping the original extension", () => {
    // Two docs can embed two different images both called `screenshot.png`; the
    // id is the only unique thing, and the only thing the bodies reference.
    expect(docAssetBytesPath({ assetId: "astaaa", fileName: "My Screenshot.PNG" })).toBe(
      "assets/astaaa.png",
    );
    expect(docAssetBytesPath({ assetId: "astaaa", fileName: "noext" })).toBe("assets/astaaa");
  });

  it("rewrites mapped ids and leaves unmapped ones byte-for-byte alone", () => {
    const body = "![](/api/assets/astold/raw) and ![](/api/assets/astgone/raw)";
    const rewritten = rewriteDocAssetIds(body, new Map([["astold", "astnew"]]));
    expect(rewritten).toBe("![](/api/assets/astnew/raw) and ![](/api/assets/astgone/raw)");
  });

  it("returns the body untouched when there is nothing to map", () => {
    const body = "![](/api/assets/astold/raw)";
    expect(rewriteDocAssetIds(body, new Map())).toBe(body);
  });

  it("stays silent about ids the package does carry", () => {
    expect(
      reportUnresolvableDocAssets("spec", "![](/api/assets/astaaa/raw)", new Set(["astaaa"])),
    ).toBeUndefined();
  });

  it("names only the ids that are missing, not every id in the body", () => {
    const warning = reportUnresolvableDocAssets(
      "spec",
      "![](/api/assets/astaaa/raw) ![](/api/assets/astbbb/raw)",
      new Set(["astaaa"]),
    );
    expect(warning).toContain("1 image(s)");
    expect(warning).toContain("astbbb");
    expect(warning).not.toContain("astaaa");
  });

  it("stays silent for a doc with no embedded assets", () => {
    expect(reportUnresolvableDocAssets("readme", "# Hello\n\nJust text.")).toBeUndefined();
  });

  it("names the doc and every id the package could not carry", () => {
    const warning = reportUnresolvableDocAssets(
      "spec",
      "![](/api/assets/astaaa/raw) ![](/api/assets/astbbb/raw)",
    );
    expect(warning).toContain('Doc "spec"');
    expect(warning).toContain("2 image(s)");
    expect(warning).toContain("astaaa");
    expect(warning).toContain("astbbb");
  });
});
