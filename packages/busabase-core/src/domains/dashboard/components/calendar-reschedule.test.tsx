import type { BaseFieldVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { rescheduledCalendarValue } from "./calendar-reschedule";

const field = (
  type: BaseFieldVO["type"],
  date: { includeTime?: boolean; timezone?: string } = {},
) =>
  ({
    id: "fld_date",
    baseId: "bas_calendar",
    slug: "publish_date",
    name: "Publish date",
    type,
    required: false,
    position: 0,
    options: { date },
  }) as BaseFieldVO;

describe("calendar rescheduling", () => {
  it("moves a plain date without shifting it through the reader's timezone", () => {
    expect(rescheduledCalendarValue(field("date"), "2026-10-02", "2026-10-05")).toBe("2026-10-05");
    expect(rescheduledCalendarValue(field("date"), "2026-10-02", "2026-02-30")).toBeNull();
  });

  it("keeps the displayed time in the field's timezone across a DST change", () => {
    const dateField = field("date", { includeTime: true, timezone: "America/New_York" });
    expect(rescheduledCalendarValue(dateField, "2026-10-31T09:30:00-04:00", "2026-11-02")).toBe(
      "2026-11-02T09:30:00-05:00",
    );
  });

  it("does not change generated timestamps or a timed date without a valid time", () => {
    expect(rescheduledCalendarValue(field("created_time"), "2026-10-02", "2026-10-05")).toBeNull();
    expect(
      rescheduledCalendarValue(field("date", { includeTime: true }), null, "2026-10-05"),
    ).toBeNull();
  });
});
