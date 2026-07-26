import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../src/domains/base/formula";

type Value = number | string | boolean | Date | null;
const resolve =
  (values: Record<string, Value> = {}) =>
  (slug: string) => {
    if (!(slug in values)) throw new Error(`unexpected field ref in test: ${slug}`);
    return values[slug];
  };

const D = (iso: string) => new Date(iso);

describe("formula date/time functions", () => {
  it("TODAY returns midnight UTC of the current date; NOW carries a time", () => {
    const today = evaluateFormula("TODAY()", resolve());
    expect(today).toBeInstanceOf(Date);
    const d = today as Date;
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    const now = evaluateFormula("NOW()", resolve());
    expect(now).toBeInstanceOf(Date);
  });

  it("DATEADD adds a count of a unit to a date", () => {
    const out = evaluateFormula(
      'DATEADD({d}, 5, "days")',
      resolve({ d: D("2026-01-01T00:00:00Z") }),
    );
    expect((out as Date).toISOString()).toBe("2026-01-06T00:00:00.000Z");
    const months = evaluateFormula(
      'DATEADD({d}, 2, "months")',
      resolve({ d: D("2026-01-31T00:00:00Z") }),
    );
    expect((months as Date).getUTCMonth()).toBe(2); // Jan(0) + 2 = March(2)
  });

  it("DATESTR and TIMESTR format the date/time portion only", () => {
    const d = D("2026-03-15T13:45:30Z");
    expect(evaluateFormula("DATESTR({d})", resolve({ d }))).toBe("2026-03-15");
    expect(evaluateFormula("TIMESTR({d})", resolve({ d }))).toBe("13:45:30");
  });

  it("DATETIME_FORMAT applies a custom token format", () => {
    const d = D("2026-03-05T09:07:03Z");
    expect(evaluateFormula('DATETIME_FORMAT({d}, "YYYY/MM/DD HH:mm:ss")', resolve({ d }))).toBe(
      "2026/03/05 09:07:03",
    );
  });

  it("DATETIME_PARSE parses an ISO string to a date", () => {
    const out = evaluateFormula('DATETIME_PARSE("2026-05-01T00:00:00Z")', resolve());
    expect((out as Date).toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("DATETIME_DIFF computes a difference in the given unit", () => {
    const a = D("2026-01-01T00:00:00Z");
    const b = D("2026-01-11T00:00:00Z");
    expect(evaluateFormula('DATETIME_DIFF({a}, {b}, "days")', resolve({ a, b }))).toBe(10);
  });

  it("DAY/MONTH/YEAR/HOUR/MINUTE/SECOND read date components (UTC)", () => {
    const d = D("2026-07-24T08:09:10Z");
    expect(evaluateFormula("DAY({d})", resolve({ d }))).toBe(24);
    expect(evaluateFormula("MONTH({d})", resolve({ d }))).toBe(7);
    expect(evaluateFormula("YEAR({d})", resolve({ d }))).toBe(2026);
    expect(evaluateFormula("HOUR({d})", resolve({ d }))).toBe(8);
    expect(evaluateFormula("MINUTE({d})", resolve({ d }))).toBe(9);
    expect(evaluateFormula("SECOND({d})", resolve({ d }))).toBe(10);
  });

  it("WEEKDAY numbers Sunday=1..Saturday=7", () => {
    // 2026-07-26 is a Sunday.
    expect(evaluateFormula("WEEKDAY({d})", resolve({ d: D("2026-07-26T00:00:00Z") }))).toBe(1);
    // 2026-07-25 is a Saturday.
    expect(evaluateFormula("WEEKDAY({d})", resolve({ d: D("2026-07-25T00:00:00Z") }))).toBe(7);
  });

  it("WEEKNUM returns a plausible week-of-year number", () => {
    const wk = evaluateFormula("WEEKNUM({d})", resolve({ d: D("2026-01-01T00:00:00Z") }));
    expect(wk).toBeGreaterThanOrEqual(1);
    expect(wk).toBeLessThanOrEqual(2);
  });

  it("WORKDAY skips weekends when adding business days", () => {
    // 2026-07-24 is a Friday; +1 workday should land on Monday 2026-07-27.
    const out = evaluateFormula("WORKDAY({d}, 1)", resolve({ d: D("2026-07-24T00:00:00Z") }));
    expect((out as Date).toISOString().slice(0, 10)).toBe("2026-07-27");
  });

  it("WORKDAY_DIFF counts business days strictly between two dates", () => {
    // Fri 07-24 -> Mon 07-27: only the weekend sits between them, 0 business days strictly between.
    const diff = evaluateFormula(
      "WORKDAY_DIFF({a}, {b})",
      resolve({ a: D("2026-07-24T00:00:00Z"), b: D("2026-07-27T00:00:00Z") }),
    );
    expect(diff).toBe(0);
  });

  it("IS_BEFORE / IS_AFTER / IS_SAME compare dates", () => {
    const a = D("2026-01-01T00:00:00Z");
    const b = D("2026-01-02T00:00:00Z");
    expect(evaluateFormula("IS_BEFORE({a}, {b})", resolve({ a, b }))).toBe(true);
    expect(evaluateFormula("IS_AFTER({a}, {b})", resolve({ a, b }))).toBe(false);
    expect(evaluateFormula("IS_SAME({a}, {a})", resolve({ a }))).toBe(true);
    expect(evaluateFormula("IS_SAME({a}, {b})", resolve({ a, b }))).toBe(false);
  });

  it("FROMNOW / TONOW measure duration relative to the current instant", () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const fromNow = evaluateFormula("FROMNOW({d})", resolve({ d: future })) as number;
    expect(fromNow).toBeGreaterThan(2.9);
    expect(fromNow).toBeLessThan(3.1);

    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const toNow = evaluateFormula("TONOW({d})", resolve({ d: past })) as number;
    expect(toNow).toBeGreaterThan(1.9);
    expect(toNow).toBeLessThan(2.1);
  });

  it("SET_LOCALE / SET_TIMEZONE are validating pass-throughs (documented simplification)", () => {
    expect(evaluateFormula('SET_LOCALE("en-US")', resolve())).toBe("en-US");
    expect(evaluateFormula('SET_TIMEZONE("UTC")', resolve())).toBe("UTC");
  });
});
