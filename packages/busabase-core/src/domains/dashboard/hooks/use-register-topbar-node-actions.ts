"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTopbarNodeActionsStore } from "../store/topbar-node-actions-store";

/**
 * Registers `actions` (the Edit-if-Doc + Pin + "..." cluster) into the shared
 * dashboard topbar for as long as the calling component stays mounted, and
 * clears it back to `null` on unmount.
 *
 * No dependency array, on purpose: `actions` is near-always a fresh JSX
 * literal from the caller (a new object identity every render — e.g. because
 * a Pin button's own `isPinned`-style visual state lives in a child, or the
 * cluster's content depends on local state like Doc's `isEditing`), so there
 * is no cheap/reliable way to memoize away re-registering it. Re-running the
 * effect every render just re-syncs the store to the latest JSX; the
 * downstream cost is a single `set()` on a store subscribed only by the
 * topbar slot, which is a normal, isolated re-render — not a loop, since
 * nothing here feeds back into this component's own render inputs.
 *
 * `enabled` (default `true`) lets a caller stay mounted but opt out of ever
 * touching the shared slot — needed because some of these view components
 * are reused for contexts that must NOT own the topbar slot even while
 * mounted:
 *   - side-panel preview instances (`hideActions` callers in
 *     node-detail-views.tsx) sit alongside the real page's view and must
 *     never overwrite its registration;
 *   - AirApp's keep-alive host (`AirAppKeepAliveHost`) keeps every visited
 *     AirApp's detail view mounted (CSS-hidden) after navigating away, so a
 *     backgrounded instance must stop re-registering once
 *     `useAirAppKeepAliveActive()` goes false, or it would keep clobbering
 *     whatever page the user actually navigated to.
 * When `enabled` is false the effect is a complete no-op (it does not even
 * clear the slot) — only an instance that actually registered something is
 * responsible for clearing it on unmount/disable.
 */
export function useRegisterTopbarNodeActions(actions: ReactNode | null, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    useTopbarNodeActionsStore.getState().setActions(actions);
    return () => {
      useTopbarNodeActionsStore.getState().setActions(null);
    };
  });
}
