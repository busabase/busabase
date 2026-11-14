import {
  mergeSearchIntoHref as mergeSpaLinkSearch,
  PAGE_LOCAL_SEARCH_PARAMS,
} from "openlib/ui/dashboard";
import { describe, expect, it } from "vitest";
import { mergeSearchIntoHref } from "./link-search";
import {
  RECORD_PREVIEW_PARAM,
  readRecordPreviewId,
  writeRecordPreviewId,
} from "./record-preview-url";

describe("record preview URL", () => {
  it("reads the record named by ?record= and ignores a blank value", () => {
    expect(readRecordPreviewId("?recordPage=2&record=rec_1")).toBe("rec_1");
    expect(readRecordPreviewId("record=%20")).toBeNull();
    expect(readRecordPreviewId("")).toBeNull();
  });

  it("writes and clears the param while keeping the view's other state", () => {
    const opened = writeRecordPreviewId("space=tnl_a&recordPage=3", "rec_1");
    expect(new URLSearchParams(opened).get("record")).toBe("rec_1");
    expect(new URLSearchParams(opened).get("recordPage")).toBe("3");
    expect(writeRecordPreviewId(opened, null)).toBe("space=tnl_a&recordPage=3");
  });

  it("never carries an open dialog into another page's link", () => {
    expect(PAGE_LOCAL_SEARCH_PARAMS).toContain(RECORD_PREVIEW_PARAM);
    // Sidebar, breadcrumbs and every other SPALink drop it too.
    expect(mergeSpaLinkSearch("/base/other", "space=tnl_a&record=rec_1")).toBe(
      "/base/other?space=tnl_a",
    );
    expect(mergeSearchIntoHref("/base/crm/rec_1", "space=tnl_a&record=rec_1")).toBe(
      "/base/crm/rec_1?space=tnl_a",
    );
    expect(mergeSearchIntoHref("/inbox/cr_1", "record=rec_1")).toBe("/inbox/cr_1");
    // The default-view redirect names the param itself and keeps it.
    expect(mergeSearchIntoHref("/base/crm/grid?record=rec_1", "record=rec_1")).toBe(
      "/base/crm/grid?record=rec_1",
    );
  });
});
