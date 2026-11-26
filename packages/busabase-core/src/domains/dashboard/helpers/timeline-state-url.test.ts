import { describe, expect, it } from "vitest";
import { writeRecordFind } from "./record-find-url";
import { readTimelineState, writeTimelineState } from "./timeline-state-url";

describe("timeline browsing URL", () => {
  it("retains period and scale through find clearing and isolates another view", () => {
    const query = writeTimelineState(
      "space=connected&recordFind=Acme&recordFindScope=base:view&fromView=timeline",
      { scale: "week", start: "2027-03-07" },
      "base:view",
    );
    const cleared = writeRecordFind(query, { query: "", fieldId: "" }, "base:view");
    expect(readTimelineState(cleared, "base:view")).toEqual({ scale: "week", start: "2027-03-07" });
    expect(readTimelineState(cleared, "another:view")).toBeNull();
    expect(new URLSearchParams(cleared).get("space")).toBe("connected");
    expect(new URLSearchParams(cleared).get("fromView")).toBe("timeline");
  });

  it.each(["2027-02-29", "2027-13-01", "2027-00-01", "2027-01-00", "2027-1-01", "bad"])(
    "ignores invalid date %s",
    (start) => {
      expect(
        readTimelineState(
          `timelineScale=month&timelineStart=${start}&timelineScope=base:view`,
          "base:view",
        ),
      ).toBeNull();
    },
  );

  it("ignores an unsupported scale", () => {
    expect(
      readTimelineState(
        "timelineScale=day&timelineStart=2027-03-01&timelineScope=base:view",
        "base:view",
      ),
    ).toBeNull();
  });
});
