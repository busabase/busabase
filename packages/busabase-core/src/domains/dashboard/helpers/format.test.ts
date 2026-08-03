import { describe, expect, it } from "vitest";
import { formatDetailTime, formatFullTime, formatListTime } from "./format";

const LOCAL_DATE_TIME = "2026-07-30T12:34:00";

describe("localized dashboard date formatting", () => {
  it.each([
    ["en", "Jul 30"],
    ["zh-CN", "7月30日"],
    ["ja", "7月30日"],
  ])("formats list dates with the application locale %s", (locale, expected) => {
    expect(formatListTime(LOCAL_DATE_TIME, locale)).toBe(expected);
  });

  it.each([
    ["en", "Jul 30, 12:34 PM"],
    ["zh-CN", "7月30日 12:34"],
    ["ja", "7月30日 12:34"],
  ])("formats detail dates with the application locale %s", (locale, expected) => {
    expect(formatDetailTime(LOCAL_DATE_TIME, locale)).toBe(expected);
  });

  it("keeps the complete timestamp when only the locale should change", () => {
    expect(formatFullTime(LOCAL_DATE_TIME, "en")).toBe(
      new Date(LOCAL_DATE_TIME).toLocaleString("en"),
    );
  });
});
