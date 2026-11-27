import { describe, expect, it } from "vitest";
import {
  readRecordPagination,
  resolveRecordPagination,
  writeRecordPagination,
} from "./record-pagination-url";

describe("record pagination URL state", () => {
  it("uses stable defaults for missing or invalid values", () => {
    expect(readRecordPagination("")).toEqual({ page: 1, pageSize: 50 });
    expect(readRecordPagination("recordPage=-2&recordPageSize=75")).toEqual({
      page: 1,
      pageSize: 50,
    });
    expect(readRecordPagination("recordPageSize=1001")).toEqual({ page: 1, pageSize: 50 });
  });

  it("reads supported page sizes and arbitrary positive pages", () => {
    expect(readRecordPagination("recordPage=6&recordPageSize=100")).toEqual({
      page: 6,
      pageSize: 100,
    });
    expect(readRecordPagination("recordPageSize=1000")).toEqual({ page: 1, pageSize: 1000 });
  });

  it("keeps a remembered size only when the URL does not name one", () => {
    expect(resolveRecordPagination("", 500)).toEqual({ page: 1, pageSize: 500 });
    expect(resolveRecordPagination("recordPage=3", 200)).toEqual({ page: 3, pageSize: 200 });
    expect(resolveRecordPagination("recordPageSize=25", 500)).toEqual({ page: 1, pageSize: 25 });
    expect(resolveRecordPagination("recordPageSize=75", 500)).toEqual({ page: 1, pageSize: 500 });
    expect(resolveRecordPagination("", null)).toEqual({ page: 1, pageSize: 50 });
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
