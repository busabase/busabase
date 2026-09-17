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
      expect(formatListDateTime(LOCAL_DATE_TIME, locale)).toBe(expected);
    },
  );

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
