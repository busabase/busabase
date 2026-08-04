/**
 * Decides WHEN the dashboard should re-validate the whole workspace.
 *
 * Pulled out of `useBusabaseLiveSync` so the policy is testable on its own: it
 * is pure bookkeeping over timestamps, and getting it wrong is expensive in a
 * way that is invisible locally. Measured on production before this existed, a
 * single inbox session re-fetched the change request list four times — it was
 * 6 MB then, so ~24 MB of redundant transfer — because:
 *
 *   - the FIRST stream connect invalidated data the page had just loaded;
 *   - returning to a browser tab fires `focus` AND `visibilitychange`, so one
 *     user action re-validated twice;
 *   - a stream that drops retries every 3s, and every retry re-validated.
 */
export interface WorkspaceRevalidationGate {
  /**
   * A live stream connected. Returns false for the very first connect (the page
   * just loaded this data), true for reconnects — where the tab may have missed
   * events, since the pub/sub layer retains no history.
   */
  onStreamConnected(now?: number): boolean;
  /** The user came back to the tab/window. Throttled — see the interval below. */
  onUserReturned(now?: number): boolean;
}

/** Floor between two whole-workspace re-validations. */
export const WORKSPACE_REVALIDATE_MIN_INTERVAL_MS = 5_000;

export const createWorkspaceRevalidationGate = (
  minIntervalMs: number = WORKSPACE_REVALIDATE_MIN_INTERVAL_MS,
): WorkspaceRevalidationGate => {
  let hasConnected = false;
  let lastRevalidatedAt = Number.NEGATIVE_INFINITY;

  const allow = (now: number): boolean => {
    if (now - lastRevalidatedAt < minIntervalMs) return false;
    lastRevalidatedAt = now;
    return true;
  };

  return {
    onStreamConnected(now = Date.now()) {
      const isReconnect = hasConnected;
      hasConnected = true;
      // The first connect is deliberately NOT throttle-charged: it did no work,
      // so it must not suppress a genuine re-validation moments later.
      return isReconnect ? allow(now) : false;
    },
    onUserReturned(now = Date.now()) {
      return allow(now);
    },
  };
};
