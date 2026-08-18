import type { RecordVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  normalizeRecordsPage,
  RECORDS_PAGE_SIZE,
  scopeRecordsPageToBase,
} from "./record-pagination";

const records = Array.from({ length: 120 }, (_, index) => ({
  id: `record-${index}`,
})) as RecordVO[];

describe("normalizeRecordsPage", () => {
  it("slices a legacy array response", () => {
    const page = normalizeRecordsPage(records);
    expect(page.records).toHaveLength(RECORDS_PAGE_SIZE);
    expect(page.nextCursor).toBe("legacy:50");
  });

  it("slices an oversized object response from a demo server", () => {
    const page = normalizeRecordsPage({ records, nextCursor: null }, "legacy:50");
    expect(page.records[0]?.id).toBe("record-50");
    expect(page.records).toHaveLength(RECORDS_PAGE_SIZE);
    expect(page.nextCursor).toBe("legacy:100");
  });

  it("preserves a bounded cursor page", () => {
    const page = { records: records.slice(0, 25), nextCursor: "opaque" };
    expect(normalizeRecordsPage(page)).toBe(page);
  });

  it("removes records leaked from other bases before pagination", () => {
    const mixed = records.map((record, index) => ({
      ...record,
      baseId: index % 2 === 0 ? "base-a" : "base-b",
    }));
    const scoped = scopeRecordsPageToBase({ records: mixed, nextCursor: null }, "base-a");
    const page = normalizeRecordsPage(scoped);
    expect(page.records).toHaveLength(RECORDS_PAGE_SIZE);
    expect(page.records.every((record) => record.baseId === "base-a")).toBe(true);
    expect(page.nextCursor).toBe("legacy:50");
  });
});
