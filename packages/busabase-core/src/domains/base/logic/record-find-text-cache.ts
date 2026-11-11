import "server-only";

import type { BaseFieldVO } from "busabase-contract/types";
import { getRecordFindTexts } from "../utils/record-find-text";

interface CacheLimits {
  maxBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
}

const DEFAULT_LIMITS: CacheLimits = {
  maxBytes: 16 * 1024 * 1024,
  maxEntries: 30_000,
  maxEntryBytes: 1024 * 1024,
};

/** Cache only pure static extraction, never record membership, labels, or permissions. */
export class RecordFindTextCache {
  private readonly entries = new Map<string, { texts: ReadonlyArray<string>; bytes: number }>();
  private bytes = 0;

  constructor(private readonly limits: CacheLimits = DEFAULT_LIMITS) {}

  getOrExtract(
    type: "html" | "markdown",
    source: string,
    extract: () => ReadonlyArray<string>,
  ): ReadonlyArray<string> {
    const key = `${type}\0${source}`;
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.texts;
    }

    const extracted = extract();
    // Count UTF-16 content plus an estimate for map/object/string overhead.
    const bytes = 2 * (key.length + extracted.reduce((sum, text) => sum + text.length, 0)) + 128;
    if (
      this.limits.maxEntries < 1 ||
      bytes > this.limits.maxEntryBytes ||
      bytes > this.limits.maxBytes
    ) {
      return extracted;
    }
    while (
      this.entries.size >= this.limits.maxEntries ||
      this.bytes + bytes > this.limits.maxBytes
    ) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.bytes -= oldest[1].bytes;
    }
    const texts = Object.freeze([...extracted]);
    this.entries.set(key, { texts, bytes });
    this.bytes += bytes;
    return texts;
  }
}

const staticTextCache = new RecordFindTextCache();

export const getCachedRecordFindTexts = (
  field: BaseFieldVO,
  value: unknown,
): ReadonlyArray<string> =>
  (field.type === "html" || field.type === "markdown") && typeof value === "string"
    ? staticTextCache.getOrExtract(field.type, value, () => getRecordFindTexts(field, value))
    : getRecordFindTexts(field, value);
