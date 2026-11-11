import type { BaseFieldVO } from "busabase-contract/types";
import { describe, expect, it, vi } from "vitest";
import {
  getCachedRecordFindTexts,
  RecordFindTextCache,
} from "../src/domains/base/logic/record-find-text-cache";

const field = (type: BaseFieldVO["type"], options: BaseFieldVO["options"] = {}): BaseFieldVO => ({
  id: "field",
  baseId: "base",
  slug: "value",
  name: "Value",
  type,
  required: false,
  position: 0,
  options,
});

describe("bounded static record-find extraction cache", () => {
  it("reuses exact source extraction across queries, but not changed source or another format", () => {
    const cache = new RecordFindTextCache({ maxBytes: 4096, maxEntryBytes: 4096, maxEntries: 10 });
    const extract = vi.fn(() => ["body"]);
    expect(cache.getOrExtract("html", "<p>body</p>", extract)).toEqual(["body"]);
    cache.getOrExtract("html", "<p>body</p>", extract);
    expect(extract).toHaveBeenCalledTimes(1);
    cache.getOrExtract("html", "<p>changed body</p>", extract);
    cache.getOrExtract("markdown", "<p>body</p>", extract);
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it("evicts the least recently used source when the entry bound is reached", () => {
    const cache = new RecordFindTextCache({ maxBytes: 4096, maxEntryBytes: 4096, maxEntries: 2 });
    const extract = vi.fn(() => ["body"]);
    cache.getOrExtract("html", "a", extract);
    cache.getOrExtract("html", "b", extract);
    cache.getOrExtract("html", "a", extract);
    cache.getOrExtract("html", "c", extract);
    cache.getOrExtract("html", "a", extract);
    expect(extract).toHaveBeenCalledTimes(3);
    cache.getOrExtract("html", "b", extract);
    expect(extract).toHaveBeenCalledTimes(4);
  });

  it("enforces the aggregate byte budget even below the entry-count bound", () => {
    const cache = new RecordFindTextCache({ maxBytes: 320, maxEntryBytes: 320, maxEntries: 100 });
    const extract = vi.fn(() => ["body"]);
    cache.getOrExtract("html", "a", extract);
    cache.getOrExtract("html", "b", extract);
    cache.getOrExtract("html", "c", extract);
    cache.getOrExtract("html", "a", extract);
    expect(extract).toHaveBeenCalledTimes(4);
  });

  it("never retains an oversized source or oversized extracted text", () => {
    const cache = new RecordFindTextCache({ maxBytes: 4096, maxEntryBytes: 256, maxEntries: 10 });
    const extract = vi.fn(() => ["body"]);
    for (let repeat = 0; repeat < 2; repeat++)
      cache.getOrExtract("html", "x".repeat(1000), extract);
    expect(extract).toHaveBeenCalledTimes(2);
    const largeResult = vi.fn(() => ["y".repeat(1000)]);
    cache.getOrExtract("markdown", "short", largeResult);
    cache.getOrExtract("markdown", "short", largeResult);
    expect(largeResult).toHaveBeenCalledTimes(2);
  });

  it("preserves full HTML/Markdown semantics without caching mutable option labels", () => {
    expect(
      getCachedRecordFindTexts(field("html"), "<p>华<strong>星</strong>&nbsp;客户</p>"),
    ).toEqual(["华星 客户"]);
    expect(
      getCachedRecordFindTexts(field("markdown"), "**华星** [交付](https://hidden.example)"),
    ).toEqual(["华星 交付"]);
    expect(
      getCachedRecordFindTexts(field("html"), `<p>${"x".repeat(12_000)}tail</p>`)[0],
    ).toContain("tail");
    const before = field("select", { choices: [{ id: "vip", name: "Before" }] });
    const after = field("select", { choices: [{ id: "vip", name: "After" }] });
    expect(getCachedRecordFindTexts(before, "vip")).toEqual(["Before"]);
    expect(getCachedRecordFindTexts(after, "vip")).toEqual(["After"]);
  });
});
