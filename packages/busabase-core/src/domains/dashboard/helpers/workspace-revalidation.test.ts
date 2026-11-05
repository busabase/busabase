import { describe, expect, it } from "vitest";
import {
  createWorkspaceRevalidationGate,
  TAB_RETURN_RECONCILE_AFTER_MS,
} from "./workspace-revalidation";

/**
 * Pins the cases that made one production inbox session re-fetch the
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

  it("does not reconcile on focus alone", () => {
    const gate = createWorkspaceRevalidationGate(5_000);
    expect(gate.onUserReturned(50_000)).toBe(false);
  });

  it("ignores a brief hide/show", () => {
    const gate = createWorkspaceRevalidationGate(5_000);
    gate.onDocumentHidden(50_000);
    expect(gate.onUserReturned(50_000 + TAB_RETURN_RECONCILE_AFTER_MS - 1)).toBe(false);
    // The following focus event belongs to the same return, not a second one.
    expect(gate.onUserReturned(50_010)).toBe(false);
  });

  it("collapses visibilitychange + focus after a long hide into one pass", () => {
    const gate = createWorkspaceRevalidationGate(5_000);
    gate.onDocumentHidden(50_000);
    expect(gate.onUserReturned(50_000 + TAB_RETURN_RECONCILE_AFTER_MS)).toBe(true);
    expect(gate.onUserReturned(50_000 + TAB_RETURN_RECONCILE_AFTER_MS + 10)).toBe(false);
  });

  it("defers a hidden reconnect and reconciles on a brief visible return", () => {
    const gate = createWorkspaceRevalidationGate(5_000);
    expect(gate.onStreamConnected(0)).toBe(false);
    gate.onDocumentHidden(10_000);
    expect(gate.onStreamConnected(11_000, { documentHidden: true })).toBe(false);
    // The reconnect proves events were missed, so the normal 30-second hide
    // threshold does not apply. The paired focus event still does not repeat it.
    expect(gate.onUserReturned(11_100)).toBe(true);
    expect(gate.onUserReturned(11_110)).toBe(false);
  });

  it("measures a long hide from the first hidden event", () => {
    const gate = createWorkspaceRevalidationGate(5_000);
    gate.onDocumentHidden(50_000);
    gate.onDocumentHidden(70_000);
    expect(gate.onUserReturned(80_000)).toBe(true);
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
    gate.onDocumentHidden(1_000);
    expect(gate.onUserReturned(1_000 + TAB_RETURN_RECONCILE_AFTER_MS)).toBe(true);
  });
});
