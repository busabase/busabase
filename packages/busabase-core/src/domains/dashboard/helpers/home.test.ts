import { describe, expect, it } from "vitest";
import {
  HOME_PENDING_PREVIEW_COUNT,
  homePendingListInput,
  isHomeDigestEmpty,
  resolveHomeIntroCard,
} from "./home";

const EMPTY_DIGEST = {
  activityCount: 0,
  isActivityLoaded: true,
  isChangeRequestsLoaded: true,
  pendingCount: 0,
  recentCount: 0,
};

describe("home digest empty state", () => {
  it("waits for both activity and change requests before showing onboarding", () => {
    expect(isHomeDigestEmpty({ ...EMPTY_DIGEST, isActivityLoaded: false })).toBe(false);
    expect(isHomeDigestEmpty({ ...EMPTY_DIGEST, isChangeRequestsLoaded: false })).toBe(false);
  });

  it("shows onboarding only after every source settles empty", () => {
    expect(isHomeDigestEmpty(EMPTY_DIGEST)).toBe(true);
  });

  it("keeps the digest when any source has content", () => {
    expect(isHomeDigestEmpty({ ...EMPTY_DIGEST, pendingCount: 1 })).toBe(false);
  });
});

describe("homePendingListInput", () => {
  it("asks only for in-review change requests, and only as many as the preview shows", () => {
    // Anything wider and Home is back to downloading every merged request to
    // filter it locally; anything narrower than the preview leaves cards empty.
    expect(homePendingListInput()).toEqual({
      status: ["in_review"],
      limit: HOME_PENDING_PREVIEW_COUNT,
    });
  });

  it("hands each caller its own object, so no query key shares a mutable array", () => {
    expect(homePendingListInput()).not.toBe(homePendingListInput());
    expect(homePendingListInput().status).not.toBe(homePendingListInput().status);
  });
});

describe("resolveHomeIntroCard", () => {
  const settled = { isDigestLoaded: true, isDigestEmpty: false, recentCount: 3 };

  it("shows a readable welcome page above everything, even in an empty space", () => {
    expect(resolveHomeIntroCard({ ...settled, welcome: "readable" })).toBe("welcome");
    expect(
      resolveHomeIntroCard({
        welcome: "readable",
        isDigestLoaded: false,
        isDigestEmpty: false,
        recentCount: 0,
      }),
    ).toBe("welcome");
    expect(
      resolveHomeIntroCard({
        welcome: "readable",
        isDigestLoaded: true,
        isDigestEmpty: true,
        recentCount: 0,
      }),
    ).toBe("welcome");
  });

  it("decides nothing while the welcome or the digest is still loading", () => {
    // Otherwise Getting started flashes before a returning member's welcome arrives.
    expect(resolveHomeIntroCard({ ...settled, welcome: "pending", recentCount: 0 })).toBeNull();
    expect(
      resolveHomeIntroCard({
        ...settled,
        welcome: "absent",
        isDigestLoaded: false,
        recentCount: 0,
      }),
    ).toBeNull();
  });

  it("falls back to Getting started for an empty space, replacing the empty sections", () => {
    expect(
      resolveHomeIntroCard({ ...settled, welcome: "absent", isDigestEmpty: true, recentCount: 0 }),
    ).toBe("gettingStartedNewSpace");
  });

  it("shows the member Getting started to someone who has visited nothing in a busy space", () => {
    expect(resolveHomeIntroCard({ ...settled, welcome: "absent", recentCount: 0 })).toBe(
      "gettingStartedMember",
    );
  });

  it("stays out of the way of a member who already knows their way around", () => {
    expect(resolveHomeIntroCard({ ...settled, welcome: "absent" })).toBeNull();
  });
});
