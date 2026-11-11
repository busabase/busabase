import { describe, expect, it } from "vitest";
import {
  clearRecordFind,
  hasStaleRecordFind,
  readRecordFind,
  writeRecordFind,
} from "./record-find-url";

describe("record find URL state", () => {
  it("commits a stable field identity and resets pagination without losing workspace context", () => {
    const query = writeRecordFind(
      "space=remote&recordPage=8&recordPageSize=25",
      { query: "  华星  ", fieldId: "fld_customer" },
      "bse_deliveries:viw_pending",
    );
    const params = new URLSearchParams(query);
    expect(params.get("space")).toBe("remote");
    expect(params.get("recordPageSize")).toBe("25");
    expect(params.get("recordPage")).toBe("1");
    expect(readRecordFind(query, "bse_deliveries:viw_pending")).toEqual({
      query: "华星",
      fieldId: "fld_customer",
    });
  });

  it("ignores another view's carried query, while the original history entry can restore it", () => {
    const query = writeRecordFind("", { query: "Acme", fieldId: "fld_name" }, "base:pending");
    expect(hasStaleRecordFind(query, "base:done")).toBe(true);
    expect(readRecordFind(query, "base:done")).toEqual({ query: "", fieldId: "" });
    expect(readRecordFind(query, "base:pending").query).toBe("Acme");
    expect(readRecordFind(query, null).query).toBe("Acme");
  });

  it("clears only find state for forward view navigation", () => {
    const query = clearRecordFind(
      "recordFind=Acme&recordFindField=fld_customer&recordFindScope=base%3Aview&space=remote",
    );
    expect(query).toBe("space=remote");
  });

  it("retains explicit field choice without a keyword and accepts shared links without a marker", () => {
    const query = writeRecordFind("", { query: "", fieldId: "fld_json" }, "base:view");
    expect(readRecordFind(query, "base:view")).toEqual({ query: "", fieldId: "fld_json" });
    expect(readRecordFind("recordFind=hello", "base:view").query).toBe("hello");
  });
});
