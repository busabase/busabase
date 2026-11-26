import { describe, expect, it } from "vitest";
import { readCalendarMonth, writeCalendarMonth } from "./calendar-month-url";
import { writeRecordFind } from "./record-find-url";

describe("calendar month URL", () => {
  it("restores a month for its own view and preserves it when find is cleared", () => {
    const search = writeCalendarMonth(
      "space=connected&recordFind=Acme&recordFindScope=base:view&fromView=calendar",
      { year: 2027, month: 2 },
      "base:view",
    );
    const cleared = writeRecordFind(search, { query: "", fieldId: "" }, "base:view");
    expect(readCalendarMonth(cleared, "base:view")).toEqual({ year: 2027, month: 2 });
    expect(new URLSearchParams(cleared).get("space")).toBe("connected");
    expect(new URLSearchParams(cleared).get("fromView")).toBe("calendar");
    expect(readCalendarMonth(search, "another:view")).toBeNull();
  });

  it.each(["2027-00", "2027-13", "27-01", "2027-1", "0000-01", "bad"])(
    "ignores malformed month %s",
    (month) => {
      expect(
        readCalendarMonth(`calendarMonth=${month}&calendarScope=base:view`, "base:view"),
      ).toBeNull();
    },
  );
});
