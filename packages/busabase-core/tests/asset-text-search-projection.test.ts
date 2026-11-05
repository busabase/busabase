import { describe, expect, it } from "vitest";
import {
  ASSET_SEARCH_CHUNK_CHARS,
  ASSET_SEARCH_MAX_CHARS,
  ASSET_SEARCH_OVERLAP_CHARS,
  AssetSearchProjectionBuilder,
} from "../src/domains/assets/logic/asset-text-search-logic";

describe("asset text projection boundaries", () => {
  it("bounds a large source and honestly marks omitted text", () => {
    const builder = new AssetSearchProjectionBuilder();
    const block = Buffer.from("a".repeat(64 * 1024));
    for (let count = 0; count < ASSET_SEARCH_MAX_CHARS / block.length; count++)
      builder.write(block);
    builder.write(Buffer.from("TAILOMITTEDAFTERCAP"));
    const projection = builder.finish();
    expect(builder.full).toBe(true);
    expect(projection.complete).toBe(false);
    expect(projection.chunks.length).toBeLessThanOrEqual(
      Math.ceil(ASSET_SEARCH_MAX_CHARS / (ASSET_SEARCH_CHUNK_CHARS - ASSET_SEARCH_OVERLAP_CHARS)),
    );
    expect(projection.chunks.every((chunk) => chunk.length <= ASSET_SEARCH_CHUNK_CHARS)).toBe(true);
    expect(projection.chunks.some((chunk) => chunk.includes("TAILOMITTEDAFTERCAP"))).toBe(false);
  });

  it("marks a source incomplete when one read crosses the cap and nothing follows", () => {
    // putText's presigned path reads 8 MB windows, so a source just over the
    // cap can arrive as a single final write with no later bytes to flag it.
    const builder = new AssetSearchProjectionBuilder();
    builder.write(Buffer.from(`${"b".repeat(ASSET_SEARCH_MAX_CHARS)}SINGLEREADTAIL`));
    const projection = builder.finish();
    expect(projection.complete).toBe(false);
    expect(projection.chunks.some((chunk) => chunk.includes("SINGLEREADTAIL"))).toBe(false);
  });

  it("preserves multibyte text across input and projection boundaries", () => {
    const builder = new AssetSearchProjectionBuilder();
    const phrase = "😀中文边界目标";
    const bytes = Buffer.from(
      `${"x".repeat(ASSET_SEARCH_CHUNK_CHARS - 1)}${phrase}${"z".repeat(1000)}`,
    );
    // Split in the middle of the emoji's UTF-8 sequence, independently from
    // the projection boundary, as real ranged object reads can do.
    const split = ASSET_SEARCH_CHUNK_CHARS + 1;
    builder.write(bytes.subarray(0, split));
    builder.write(bytes.subarray(split));
    const projection = builder.finish();
    expect(projection.complete).toBe(true);
    expect(projection.chunks.some((chunk) => chunk.includes(phrase))).toBe(true);
    for (const chunk of projection.chunks) {
      expect(chunk).not.toContain("\ufffd");
      expect(Buffer.from(chunk, "utf8").toString("utf8")).toBe(chunk);
    }
  });
});
