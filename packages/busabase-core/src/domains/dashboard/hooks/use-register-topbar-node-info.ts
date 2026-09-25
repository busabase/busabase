"use client";

import { useEffect } from "react";
import { type TopbarNodeInfo, useTopbarNodeInfoStore } from "../store/topbar-node-info-store";

/**
 * Registers the node a detail view is showing into the shared dashboard
 * topbar, which renders the single Info button (description tooltip + node
 * settings dialog) for every node type. Clears the slot on unmount.
 *
 * Unlike `useRegisterTopbarNodeActions` — whose payload is a fresh JSX literal
 * every render and therefore cannot be memoized — this payload is plain data,
 * so the effect is keyed on the individual fields. It only re-runs when the
 * node actually changes, instead of on every render of the calling view.
 *
 * `enabled` (default `true`) exists for exactly the same reason it does on the
 * actions hook: some of these view components stay mounted in contexts that
 * must NOT own the shared slot.
 *   - side-panel preview instances (`hideActions` / `previewOnly` callers) sit
 *     alongside the real page's view and must never overwrite its registration;
 *   - AirApp's keep-alive host keeps every visited AirApp's detail view mounted
 *     (CSS-hidden) after navigating away, so a backgrounded instance must stop
 *     registering once `useAirAppKeepAliveActive()` goes false.
 * When `enabled` is false the effect is a complete no-op (it does not even
 * clear the slot) — only an instance that actually registered something is
 * responsible for clearing it.
 */
export function useRegisterTopbarNodeInfo(info: TopbarNodeInfo | null, enabled = true): void {
  const orpc = info?.orpc ?? null;
  const nodeId = info?.nodeId ?? null;
  const nodeType = info?.nodeType ?? null;
  const nodeName = info?.nodeName ?? null;
  const nodeSlug = info?.nodeSlug ?? null;
  const description = info?.description ?? null;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    useTopbarNodeInfoStore.getState().setInfo(
      orpc && nodeId && nodeType
        ? {
            description,
            nodeId,
            nodeName: nodeName ?? "",
            ...(nodeSlug ? { nodeSlug } : {}),
            nodeType,
            orpc,
          }
        : null,
    );
    return () => {
      useTopbarNodeInfoStore.getState().setInfo(null);
    };
  }, [description, enabled, nodeId, nodeName, nodeSlug, nodeType, orpc]);
}
