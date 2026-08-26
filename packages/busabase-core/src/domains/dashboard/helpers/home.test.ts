import { describe, expect, it } from "vitest";
import { isHomeDigestEmpty } from "./home";

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
