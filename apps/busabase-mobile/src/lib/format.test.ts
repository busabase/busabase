import { describe, expect, it } from "vitest";
import { formatListDateTime, formatListTime } from "./format";

// Pinned "now" values so the year rule is tested against a fixed calendar,
// not against whatever year the suite happens to run in.
const SAME_YEAR_NOW = new Date("2026-09-17T09:00:00");
const NEXT_YEAR_NOW = new Date("2027-01-02T09:00:00");
const EVENT = "2026-07-30T12:34:00";

describe("formatListDateTime", () => {
  it("keeps the clock time down to the second", () => {
    expect(formatListDateTime(EVENT, SAME_YEAR_NOW)).toBe("Jul 30, 12:34:00 PM");
  });

  /**
   * The mobile twin of the web rule in busabase-core: the year is worth its
   * width — scarce on a phone row — only when it is surprising.
   */
  it("adds the year once the event is no longer in the current calendar year", () => {
    expect(formatListDateTime(EVENT, NEXT_YEAR_NOW)).toBe("Jul 30, 2026, 12:34:00 PM");
  });

  it("treats the year boundary as a calendar boundary, not a rolling 365 days", () => {
    // 11 months apart, but a different calendar year: the year must show.
    expect(formatListDateTime("2026-02-10T08:00:00", new Date("2027-01-05T08:00:00"))).toBe(
      "Feb 10, 2026, 08:00:00 AM",
    );
    // 11 months apart inside one calendar year: no year, the row stays narrow.
    expect(formatListDateTime("2026-01-05T08:00:00", new Date("2026-12-10T08:00:00"))).toBe(
      "Jan 5, 08:00:00 AM",
    );
  });

  it.each([null, undefined, "", "not-a-date"])("renders nothing for %s", (value) => {
    expect(formatListDateTime(value, SAME_YEAR_NOW)).toBe("");
  });
});

describe("formatListTime", () => {
  // Unchanged on purpose: change-request cards, record cards and webhook rows
  // are dense lists where the date alone is the right amount of information.
  it("stays date-only", () => {
    expect(formatListTime(EVENT)).toBe("Jul 30");
  });
});
