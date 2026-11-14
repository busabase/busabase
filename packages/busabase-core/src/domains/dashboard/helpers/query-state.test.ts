import { describe, expect, it } from "vitest";
import { retryRecordRead, shouldShowInitialLoadingState } from "./query-state";

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

describe("retrying a read of a view's records", () => {
  const tooLarge = new Error(
    "This view has too many records to work through. Add a filter to narrow it, then try again.",
  );

  it("never retries a view too large to read: it fails the same way every time", () => {
    expect(retryRecordRead(0, tooLarge)).toBe(false);
    expect(retryRecordRead(1, tooLarge)).toBe(false);
  });

  it("keeps the default three attempts for any other failure", () => {
    const network = new Error("Failed to fetch");
    expect([0, 1, 2].map((attempt) => retryRecordRead(attempt, network))).toEqual([
      true,
      true,
      true,
    ]);
    expect(retryRecordRead(3, network)).toBe(false);
    expect(retryRecordRead(0, "not even an Error")).toBe(true);
  });
});
