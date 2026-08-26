import { describe, expect, it } from "vitest";
import { shouldShowInitialLoadingState } from "./query-state";

describe("initial query state", () => {
  it("shows loading while unresolved data is being fetched", () => {
    expect(shouldShowInitialLoadingState(null, true)).toBe(true);
  });

  it("keeps authoritative data visible during a background refresh", () => {
    expect(shouldShowInitialLoadingState([], true)).toBe(false);
    expect(shouldShowInitialLoadingState({ id: "resolved" }, true)).toBe(false);
  });

  it("allows the settled empty or not-found state", () => {
    expect(shouldShowInitialLoadingState(null, false)).toBe(false);
  });
});
