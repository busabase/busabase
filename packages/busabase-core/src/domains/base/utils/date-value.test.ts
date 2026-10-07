import { describe, expect, it } from "vitest";
import {
  describeDateFieldValue,
  formatDateFieldValue,
  fromDateTimeInputValue,
  getCalendarDateRange,
  getDateFieldDayKey,
  getDateFieldOptions,
  getDateFieldSortKey,
  normalizeDateFieldText,
  parseDateFieldValue,
  toDateInputValue,
  toDateTimeInputValue,
} from "./date-value";

// Run this file under several TZ values (see the package's test notes): every
// expectation about a day value must hold whatever zone the runner is in.
const READERS = ["Asia/Shanghai", "Europe/London", "America/Los_Angeles", "Pacific/Kiritimati"];

describe("day values are never shifted", () => {
  it.each(READERS)("a picked day stays October 2 for a reader in %s", (readerTimeZone) => {
    for (const value of ["2026-10-02", "2026-10-02T00:00:00.000Z", "2026-10-02T00:00Z"]) {
      expect(getDateFieldDayKey(value, {}, readerTimeZone)).toBe("2026-10-02");
      expect(formatDateFieldValue(value, { locale: "en", readerTimeZone })).toBe(
        "Fri, Oct 2, 2026",
      );
    }
  });

  it("does not depend on the zone this process runs in", () => {
    expect(getDateFieldDayKey("2026-10-02")).toBe("2026-10-02");
    expect(formatDateFieldValue("2026-10-02", { locale: "zh-CN" })).toBe("2026年10月2日周五");
    expect(toDateInputValue("2026-10-02T00:00:00.000Z")).toBe("2026-10-02");
  });

  it("reads loose text naming a Tuesday or Thursday as a day, not an instant", () => {
    // The capital T of "Tue"/"Thu" is not the ISO date/time separator — this is
    // also the app's own English display format, pasted back into a cell.
    expect(normalizeDateFieldText("Tue, Oct 6, 2026")).toBe("2026-10-06");
    expect(normalizeDateFieldText("Thu Oct 01 2026")).toBe("2026-10-01");
    expect(parseDateFieldValue("Tue, Oct 6, 2026")?.kind).toBe("day");
  });

  it("rejects impossible days rather than rolling them over", () => {
    expect(parseDateFieldValue("2026-02-30")).toBeNull();
    expect(parseDateFieldValue("not a date")).toBeNull();
  });
});

describe("instants with a time", () => {
  const beijingSixPm = "2026-10-02T18:00:00+08:00";
  const includeTime = { includeTime: true };

  it("shows each reader their own local time", () => {
    expect(
      formatDateFieldValue(beijingSixPm, {
        locale: "en",
        options: includeTime,
        readerTimeZone: "Europe/London",
      }),
    ).toBe("Fri, Oct 2, 2026, 11:00 AM GMT+1");
    expect(
      formatDateFieldValue(beijingSixPm, {
        locale: "en",
        options: includeTime,
        readerTimeZone: "Asia/Shanghai",
      }),
    ).toBe("Fri, Oct 2, 2026, 6:00 PM GMT+8");
  });

  it("tells a reader what the writer typed, and flags a changed day", () => {
    const saturdayOneAm = "2026-10-03T01:00:00+08:00";
    const london = describeDateFieldValue(saturdayOneAm, {
      locale: "en",
      options: includeTime,
      readerTimeZone: "Europe/London",
    });
    expect(london?.text).toBe("Fri, Oct 2, 2026, 6:00 PM GMT+1");
    expect(london?.dayShift).toBe(-1);
    expect(london?.enteredAs).toBe("Sat, Oct 3, 2026, 1:00 AM (UTC+08:00)");

    const beijing = describeDateFieldValue(saturdayOneAm, {
      locale: "en",
      options: includeTime,
      readerTimeZone: "Asia/Shanghai",
    });
    expect(beijing?.dayShift).toBe(0);
    expect(beijing?.enteredAs).toBeNull();
  });

  it("pins every reader to the field's zone, and still offers their own time", () => {
    const pinned = describeDateFieldValue("2026-10-02T10:00:00Z", {
      locale: "en",
      options: { includeTime: true, timezone: "Asia/Shanghai" },
      readerTimeZone: "America/Los_Angeles",
    });
    expect(pinned?.text).toBe("Fri, Oct 2, 2026, 6:00 PM GMT+8");
    expect(pinned?.readerLocal).toBe("Fri, Oct 2, 2026, 3:00 AM PDT");
  });

  it("falls back to the reader's zone for an unknown field zone", () => {
    expect(
      formatDateFieldValue(beijingSixPm, {
        locale: "en",
        options: { includeTime: true, timezone: "Mars/Olympus" },
        readerTimeZone: "Asia/Shanghai",
      }),
    ).toBe("Fri, Oct 2, 2026, 6:00 PM GMT+8");
  });

  it("a date-only field shows an instant as the reader's day", () => {
    expect(
      formatDateFieldValue("2026-10-02T17:00:00Z", {
        locale: "en",
        readerTimeZone: "Asia/Shanghai",
      }),
    ).toBe("Sat, Oct 3, 2026");
  });
});

describe("datetime-local round trip", () => {
  it("keeps the zone's offset, including across DST", () => {
    expect(fromDateTimeInputValue("2026-10-02T18:00", "Asia/Shanghai")).toBe(
      "2026-10-02T18:00:00+08:00",
    );
    expect(fromDateTimeInputValue("2026-10-02T18:00", "Europe/London")).toBe(
      "2026-10-02T18:00:00+01:00",
    );
    expect(fromDateTimeInputValue("2026-12-02T18:00", "Europe/London")).toBe(
      "2026-12-02T18:00:00+00:00",
    );
    expect(fromDateTimeInputValue("2026-10-02T18:00", "America/Los_Angeles")).toBe(
      "2026-10-02T18:00:00-07:00",
    );
    expect(fromDateTimeInputValue("2026-02-30T18:00", "Asia/Shanghai")).toBeNull();
  });

  it("reads a stored instant back into the zone it is edited in", () => {
    expect(toDateTimeInputValue("2026-10-02T18:00:00+08:00", "Europe/London")).toBe(
      "2026-10-02T11:00",
    );
    expect(toDateTimeInputValue("2026-10-02", "Europe/London")).toBe("2026-10-02T00:00");
  });
});

describe("import normalization", () => {
  it("keeps the day the user typed", () => {
    expect(normalizeDateFieldText("2026-10-02")).toBe("2026-10-02");
    expect(normalizeDateFieldText("10/2/2026")).toBe("2026-10-02");
    expect(normalizeDateFieldText("Oct 2, 2026")).toBe("2026-10-02");
    expect(normalizeDateFieldText("2026-10-02T00:00:00.000Z")).toBe("2026-10-02");
  });

  it("keeps an exact instant exact", () => {
    expect(normalizeDateFieldText("2026-10-02T18:00:00+08:00")).toBe("2026-10-02T10:00:00.000Z");
    expect(normalizeDateFieldText("nope")).toBeNull();
    expect(normalizeDateFieldText("")).toBeNull();
  });
});

describe("filter/sort keys", () => {
  it("sort chronologically and ignore locale", () => {
    const keys = ["2026-10-12", "2026-9-01", "10/2/2026"].map((v) => getDateFieldSortKey(v));
    expect(keys).toEqual(["2026-10-12", "2026-09-01", "2026-10-02"]);
    expect([...keys].sort()).toEqual(["2026-09-01", "2026-10-02", "2026-10-12"]);
    expect(getDateFieldSortKey("2026-10-02")).toBe("2026-10-02");
    expect(getDateFieldSortKey("2026-10-02T18:00:00+08:00", { includeTime: true })).toBe(
      "2026-10-02 10:00",
    );
    expect(
      getDateFieldSortKey("2026-10-02T18:00:00+08:00", {
        includeTime: true,
        timezone: "Asia/Shanghai",
      }),
    ).toBe("2026-10-02 18:00");
  });
});

describe("options", () => {
  it("reads options.date defensively", () => {
    expect(getDateFieldOptions(undefined)).toEqual({});
    expect(getDateFieldOptions({ date: { includeTime: true, timezone: "Asia/Shanghai" } })).toEqual(
      {
        includeTime: true,
        timezone: "Asia/Shanghai",
      },
    );
    expect(getDateFieldOptions({ date: { includeTime: "yes" } })).toEqual({ includeTime: false });
  });
});

describe("calendar month range", () => {
  it("brackets a date field's UTC-midnight day values, a day wider each way", () => {
    // A local grid Sep 27 – Nov 8 (exclusive), wherever this runs.
    const range = getCalendarDateRange("date", new Date(2026, 8, 27), new Date(2026, 10, 8));
    expect(range).toEqual({ gte: "2026-09-26T00:00:00.000Z", lt: "2026-11-09T00:00:00.000Z" });
    // The first and last grid days are inside it in every zone.
    expect("2026-09-27T00:00:00.000Z" >= range.gte).toBe(true);
    expect("2026-11-07T00:00:00.000Z" < range.lt).toBe(true);
  });

  it("keeps local instant bounds for system timestamps", () => {
    const start = new Date(2026, 8, 27);
    const end = new Date(2026, 10, 8);
    expect(getCalendarDateRange("created_time", start, end)).toEqual({
      gte: start.toISOString(),
      lt: end.toISOString(),
    });
  });
});
