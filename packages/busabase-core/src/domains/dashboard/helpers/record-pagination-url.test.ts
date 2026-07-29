import { describe, expect, it } from "vitest";
import { readRecordPagination, writeRecordPagination } from "./record-pagination-url";

describe("record pagination URL state", () => {
  it("uses stable defaults for missing or invalid values", () => {
    expect(readRecordPagination("")).toEqual({ page: 1, pageSize: 50 });
    expect(readRecordPagination("recordPage=-2&recordPageSize=75")).toEqual({
      page: 1,
      pageSize: 50,
    });
  });

  it("reads supported page sizes and arbitrary positive pages", () => {
    expect(readRecordPagination("recordPage=6&recordPageSize=100")).toEqual({
      page: 6,
      pageSize: 100,
    });
  });

  it("preserves unrelated query parameters when writing", () => {
    const next = new URLSearchParams(
      writeRecordPagination("demo=1&space=tnl_123&recordPage=2", { page: 7, pageSize: 25 }),
    );
    expect(Object.fromEntries(next)).toEqual({
      demo: "1",
      space: "tnl_123",
      recordPage: "7",
      recordPageSize: "25",
    });
  });
});
