import { describe, expect, it } from "vitest";
import {
  formatDetailTime,
  formatFullTime,
  formatListDateTime,
  formatListTime,
  formatMemberChipLabel,
  formatUserRefLabel,
} from "./format";

const LOCAL_DATE_TIME = "2026-07-30T12:34:00";
// Pinned "now" values so the year rule is tested against a fixed calendar,
// not against whatever year the suite happens to run in.
const SAME_YEAR_NOW = new Date("2026-09-17T09:00:00");
const NEXT_YEAR_NOW = new Date("2027-01-02T09:00:00");

describe("localized dashboard date formatting", () => {
  it.each([
    ["en", "Jul 30"],
    ["zh-CN", "7月30日"],
    ["ja", "7月30日"],
  ])("formats list dates with the application locale %s", (locale, expected) => {
    expect(formatListTime(LOCAL_DATE_TIME, locale)).toBe(expected);
  });

  it.each([
    ["en", "Jul 30, 12:34:00 PM"],
    ["zh-CN", "7月30日 12:34:00"],
    ["ja", "7月30日 12:34:00"],
  ])(
    "keeps the clock time on activity-feed rows for the application locale %s",
    (locale, expected) => {
      expect(formatListDateTime(LOCAL_DATE_TIME, locale, SAME_YEAR_NOW)).toBe(expected);
    },
  );

  /**
   * The year is the one part of the timestamp that is worth its width only when
   * it is surprising. Read inside 2026 a 2026 event needs no year; read in 2027
   * the same event does, or "Jul 30" silently reads as this year.
   */
  it.each([
    ["en", "Jul 30, 2026, 12:34:00 PM"],
    ["zh-CN", "2026年7月30日 12:34:00"],
    ["ja", "2026年7月30日 12:34:00"],
  ])(
    "adds the year once the event is no longer in the current calendar year (%s)",
    (locale, expected) => {
      expect(formatListDateTime(LOCAL_DATE_TIME, locale, NEXT_YEAR_NOW)).toBe(expected);
    },
  );

  it("treats the year boundary as a calendar boundary, not a rolling 365 days", () => {
    // 11 months apart, but a different calendar year: the year must show.
    expect(formatListDateTime("2026-02-10T08:00:00", "en", new Date("2027-01-05T08:00:00"))).toBe(
      "Feb 10, 2026, 08:00:00 AM",
    );
    // 11 months apart inside one calendar year: no year, the column stays narrow.
    expect(formatListDateTime("2026-01-05T08:00:00", "en", new Date("2026-12-10T08:00:00"))).toBe(
      "Jan 5, 08:00:00 AM",
    );
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

/**
 * The label on a people-typed cell's chip. `created_by` cells rendered through
 * `formatOpaqueUserId` for their whole life; when they started sharing the
 * `member` chip, taking `formatUserRefLabel`'s fallback instead turned
 * "Field Type Agent" into "Unknown user field-type" across the demo dataset.
 */
describe("formatMemberChipLabel", () => {
  const ada = { id: "usr_1", name: "Ada Lovelace", email: "ada@x.com", image: null, role: null };

  it("uses a resolved person's own name", () => {
    expect(formatMemberChipLabel(ada, "usr_1")).toBe("Ada Lovelace");
  });

  it("prettifies a human-readable actor id nothing resolved", () => {
    expect(formatMemberChipLabel(undefined, "field-type-agent")).toBe("Field Type Agent");
    expect(formatMemberChipLabel(null, "ops-reconcile-agent")).toBe("Ops Reconcile Agent");
  });

  it("prettifies even when a UserRefVO came back with no name", () => {
    // The anonymous/public surface and the departed-member case both produce
    // this shape: an entry exists, but the host withheld or lost the identity.
    const nameless = { id: "field-type-agent", name: null, email: null, image: null, role: null };
    expect(formatMemberChipLabel(nameless, "field-type-agent")).toBe("Field Type Agent");
  });

  it("knows the local identities", () => {
    expect(formatMemberChipLabel(undefined, "local-editor")).toBe("Local Editor");
  });

  it("falls back to a short id for an opaque one", () => {
    expect(formatMemberChipLabel(undefined, "abc123def456")).toContain("abc123");
  });

  it("differs from formatUserRefLabel, which is for PEOPLE not cells", () => {
    // Same input, deliberately different answers: a comment author who cannot be
    // resolved is an "Unknown user"; a cell's actor id is still worth naming.
    expect(formatUserRefLabel(undefined, "field-type-agent")).toContain("Unknown user");
    expect(formatMemberChipLabel(undefined, "field-type-agent")).toBe("Field Type Agent");
  });
});
