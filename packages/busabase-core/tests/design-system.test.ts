import { describe, expect, it } from "vitest";
import { statusTone } from "../src/domains/dashboard/helpers/change-request";

describe("review status semantic tones", () => {
  it.each([
    ["merged", "merged"],
    ["approved", "merged"],
    ["in_review", "review"],
    ["changes_requested", "review"],
    ["conflict", "rejected"],
    ["rejected", "rejected"],
    ["abandoned", "rejected"],
  ])("routes %s through the %s token family", (status, token) => {
    const classes = statusTone(status);
    expect(classes).toContain(`border-${token}/35`);
    expect(classes).toContain(`bg-${token}/10`);
    expect(classes).toContain(`text-${token}-strong`);
    expect(classes).toContain(`dark:text-${token}-soft`);
    expect(classes).not.toMatch(/(?:amber|emerald|teal|gray)-/);
  });
});
