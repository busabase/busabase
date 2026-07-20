import { describe, expect, it } from "vitest";
import {
  INLINE_ASSET_TEXT_MAX_BYTES,
  isTxtFile,
  utf8ByteLength,
} from "../src/domains/dashboard/helpers/asset-text-grep";

describe("asset searchable-text helpers", () => {
  it("counts UTF-8 bytes rather than JavaScript characters", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("你好")).toBe(6);
    expect(utf8ByteLength("a".repeat(INLINE_ASSET_TEXT_MAX_BYTES + 1))).toBe(
      INLINE_ASSET_TEXT_MAX_BYTES + 1,
    );
  });

  it("uses the file extension because browser MIME types are unreliable", () => {
    expect(isTxtFile({ name: "extract.TXT" })).toBe(true);
    expect(isTxtFile({ name: "extract.txt" })).toBe(true);
    expect(isTxtFile({ name: "extract.csv" })).toBe(false);
  });
});
