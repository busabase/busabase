import { describe, expect, it } from "vitest";
import { buildPreviewFileEmbedUrl } from "./file-tree-files";

describe("buildPreviewFileEmbedUrl", () => {
  it("adds the documented embed and locale parameters while preserving existing values", () => {
    expect(
      buildPreviewFileEmbedUrl("https://previewfile.dev/preview/abc?theme=dark", "zh-CN"),
    ).toBe("https://previewfile.dev/preview/abc?theme=dark&embed=true&lang=zh-CN&locale=zh-CN");
  });

  it("replaces untrusted embed and locale parameters", () => {
    expect(
      buildPreviewFileEmbedUrl(
        "https://previewfile.dev/preview/abc?embed=false&lang=en&locale=en",
        "ja",
      ),
    ).toBe("https://previewfile.dev/preview/abc?embed=true&lang=ja&locale=ja");
  });
});
