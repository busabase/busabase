/**
 * Decides WHEN the dashboard should reconcile its currently visible data.
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
  onStreamConnected(now?: number, options?: { documentHidden?: boolean }): boolean;
  /**
   * Record when the user left (document hidden or window blurred), without
   * resetting an earlier departure.
   */
  onDocumentHidden(now?: number): void;
  /**
   * The user came back to the visible document. Only the first return after a
   * meaningful hide is eligible, so the visibility/focus pair does one refresh.
   */
  onUserReturned(now?: number): boolean;
}

/** Floor between two current-screen reconciliations. */
export const WORKSPACE_REVALIDATE_MIN_INTERVAL_MS = 5_000;

/**
 * Brief tab switches are common while copying links or checking another page.
 * Only a real absence should pay the cost of refetching the current screen.
 */
export const TAB_RETURN_RECONCILE_AFTER_MS = 30_000;

export const createWorkspaceRevalidationGate = (
  minIntervalMs: number = WORKSPACE_REVALIDATE_MIN_INTERVAL_MS,
  minHiddenMs: number = TAB_RETURN_RECONCILE_AFTER_MS,
): WorkspaceRevalidationGate => {
  let hasConnected = false;
  let lastRevalidatedAt = Number.NEGATIVE_INFINITY;
  let hiddenSince: number | null = null;
  let reconnectWhileHidden = false;

  const allow = (now: number): boolean => {
    if (now - lastRevalidatedAt < minIntervalMs) return false;
    lastRevalidatedAt = now;
    return true;
  };

  return {
    onStreamConnected(now = Date.now(), options) {
      const isReconnect = hasConnected;
      hasConnected = true;
      if (options?.documentHidden) {
        // A reconnect can prove that events were missed while the tab was
        // hidden, but there is no reason to spend data for a screen nobody is
        // looking at. Remember the gap and reconcile on the next visible return.
        if (isReconnect) reconnectWhileHidden = true;
        return false;
      }
      // The first connect is deliberately NOT throttle-charged: it did no work,
      // so it must not suppress a genuine re-validation moments later.
      return isReconnect ? allow(now) : false;
    },
    onDocumentHidden(now = Date.now()) {
      // `visibilitychange` can fire more than once while the tab stays hidden.
      // Keep the original timestamp so the absence is measured from the first.
      hiddenSince ??= now;
    },
    onUserReturned(now = Date.now()) {
      const hiddenAt = hiddenSince;
      const missedEventsWhileHidden = reconnectWhileHidden;
      // Consume the hide even when it was too short or throttled. A following
      // `focus` event belongs to the same return and must not try again.
      hiddenSince = null;
      reconnectWhileHidden = false;
      if (missedEventsWhileHidden) {
        // A reconnect while hidden is itself proof of a gap. Reconcile even if
        // the user was away for less than the normal tab-switch threshold.
        lastRevalidatedAt = now;
        return true;
      }
      if (hiddenAt === null || now - hiddenAt < minHiddenMs) return false;
      return allow(now);
    },
  };
};
