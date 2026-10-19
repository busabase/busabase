import { describe, expect, it } from "vitest";
import { HOME_PENDING_PREVIEW_COUNT, homePendingListInput, isHomeDigestEmpty } from "./home";

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
