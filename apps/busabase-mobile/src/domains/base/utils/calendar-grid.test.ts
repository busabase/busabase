import { describe, expect, it } from "vitest";
import { buildMonthGrid, dayKey, recordDayKey, shiftMonth } from "./calendar-grid";

describe("dayKey", () => {
  it("formats in local time, zero-padded", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("recordDayKey", () => {
  it("parses an ISO string into a day key", () => {
    expect(recordDayKey("2026-03-14T10:00:00.000Z")).not.toBeNull();
  });

  // Run under TZ=America/Los_Angeles and TZ=Asia/Shanghai: a day value names a
  // calendar day, so it must land on Oct 2 for every reader. Parsing it with
  // `new Date()` put it on Oct 1 for anyone west of UTC.
  it("puts a day value on its own day in every time zone", () => {
    expect(recordDayKey("2026-10-02")).toBe("2026-10-02");
    // The UTC-midnight form older import/convert paths wrote is also a day.
    expect(recordDayKey("2026-10-02T00:00:00.000Z")).toBe("2026-10-02");
  });

  it("reads a date-time value in the field's pinned zone", () => {
    const options = { includeTime: true, timezone: "Asia/Shanghai" };
    // 18:00 UTC on Oct 1 is already 02:00 on Oct 2 in Shanghai.
    expect(recordDayKey("2026-10-01T18:00:00Z", options)).toBe("2026-10-02");
    expect(recordDayKey("2026-10-01T18:00:00Z", { ...options, timezone: "UTC" })).toBe(
      "2026-10-01",
    );
  });

  it("returns null for a missing or unparseable value", () => {
    expect(recordDayKey(undefined)).toBeNull();
    expect(recordDayKey("")).toBeNull();
    expect(recordDayKey("not a date")).toBeNull();
  });
});

describe("buildMonthGrid", () => {
  it("always yields exactly 42 days starting on a Sunday", () => {
    const grid = buildMonthGrid(2026, 1); // February 2026
    expect(grid.days).toHaveLength(42);
    expect(grid.gridStart.getDay()).toBe(0);
  });

  it("gridEnd is 42 days after gridStart", () => {
    const grid = buildMonthGrid(2026, 5);
    const diffDays = (grid.gridEnd.getTime() - grid.gridStart.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(42);
  });
});

describe("shiftMonth", () => {
  it("wraps December -> January across a year boundary", () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
  });

  it("wraps January -> December across a year boundary", () => {
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  });

  it("steps within a year otherwise", () => {
    expect(shiftMonth({ year: 2026, month: 5 }, 1)).toEqual({ year: 2026, month: 6 });
    expect(shiftMonth({ year: 2026, month: 5 }, -1)).toEqual({ year: 2026, month: 4 });
  });
});
