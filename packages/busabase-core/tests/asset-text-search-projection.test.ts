import { describe, expect, it } from "vitest";
import {
  ASSET_SEARCH_CHUNK_CHARS,
  ASSET_SEARCH_MAX_CHARS,
  ASSET_SEARCH_OVERLAP_CHARS,
  AssetSearchProjectionBuilder,
  createRateLimitedLog,
  queryUsesTrigramIndex,
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

describe("which queries the trigram index can serve", () => {
  it("needs a run of three word characters between wildcards", () => {
    expect(queryUsesTrigramIndex("紫鹭结算凭证")).toBe(true);
    expect(queryUsesTrigramIndex("invoice")).toBe(true);
    expect(queryUsesTrigramIndex("合同")).toBe(false);
    expect(queryUsesTrigramIndex("ab")).toBe(false);
    expect(queryUsesTrigramIndex("a b c")).toBe(false);
    expect(queryUsesTrigramIndex("50%_x")).toBe(false);
    expect(queryUsesTrigramIndex("Order-2024")).toBe(true);
  });
});

describe("failure logging cannot flood the log", () => {
  it("writes up to the limit per window, then reports how many it held back", () => {
    let clock = 0;
    const lines: string[] = [];
    const log = createRateLimitedLog((line) => lines.push(line), {
      max: 2,
      windowMs: 1_000,
      now: () => clock,
    });
    for (const line of ["a", "b", "c", "d"]) log(line);
    expect(lines).toEqual(["a", "b"]);
    clock = 999;
    log("e");
    expect(lines).toEqual(["a", "b"]);
    clock = 1_000;
    log("f");
    expect(lines).toEqual(["a", "b", "[asset-text-search] 3 similar lines suppressed", "f"]);
  });
});
