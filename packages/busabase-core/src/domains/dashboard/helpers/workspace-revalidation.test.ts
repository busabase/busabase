import { describe, expect, it } from "vitest";
import { createWorkspaceRevalidationGate } from "./workspace-revalidation";

/**
 * Pins the three cases that made one production inbox session re-fetch the
 * change request list four times. Each is easy to reintroduce and impossible to
 * notice locally, where the payload is small and the stream never drops.
 */
describe("workspace revalidation gate", () => {
  it("does not re-validate on the first stream connect", () => {
    const gate = createWorkspaceRevalidationGate();
    // The page has just loaded this data; throwing it away here means fetching
    // the whole workspace twice on every visit.
    expect(gate.onStreamConnected(1_000)).toBe(false);
  });

  it("does re-validate on a reconnect, because pub/sub keeps no history", () => {
    const gate = createWorkspaceRevalidationGate();
    gate.onStreamConnected(1_000);
    expect(gate.onStreamConnected(20_000)).toBe(true);
  });

  it("collapses the focus + visibilitychange pair a tab return fires into one", () => {
    const gate = createWorkspaceRevalidationGate(5_000);
    // Both events fire for a single user action, milliseconds apart.
    expect(gate.onUserReturned(50_000)).toBe(true);
    expect(gate.onUserReturned(50_010)).toBe(false);
  });

  it("throttles a reconnect storm instead of re-fetching every retry", () => {
    const gate = createWorkspaceRevalidationGate(5_000);
    gate.onStreamConnected(0); // first connect
    // The stream retries every 3s; without throttling each retry re-fetches
    // the entire workspace even though nothing changed.
    expect(gate.onStreamConnected(3_000)).toBe(true); // converges once
    expect(gate.onStreamConnected(6_000)).toBe(false); // 3s later — suppressed
    // 6s after the last one: the floor has passed, so a genuinely later
    // reconnect converges again rather than leaving the tab stale forever.
    expect(gate.onStreamConnected(9_000)).toBe(true);
    expect(gate.onStreamConnected(12_000)).toBe(false); // 3s later — suppressed
  });

  it("lets the first connect not suppress a real re-validation right after it", () => {
    const gate = createWorkspaceRevalidationGate(5_000);
    expect(gate.onStreamConnected(0)).toBe(false);
    // The first connect did no work, so it must not consume the throttle
    // budget — a tab return one second later still converges.
    expect(gate.onUserReturned(1_000)).toBe(true);
  });
});
