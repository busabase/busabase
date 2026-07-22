"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import type { NodeDetailRenderer } from "../../dashboard/node-detail-registry";
import { useAirAppKeepAliveStore } from "../store/airapp-keepalive-store";

const EMPTY_SLUGS: string[] = [];
const AirAppKeepAliveScopeContext = createContext<string | undefined>(undefined);
const AirAppKeepAliveActiveContext = createContext(true);

export const useAirAppKeepAliveScope = () => useContext(AirAppKeepAliveScopeContext);
export const useAirAppKeepAliveActive = () => useContext(AirAppKeepAliveActiveContext);

interface AirAppKeepAliveHostProps {
  activeSlug: string | null;
  enabled?: boolean;
  fallback: ReactNode;
  orpc: BusabaseQueryUtils;
  renderer?: NodeDetailRenderer;
  scopeKey: string;
}

/**
 * Owns the real AirApp detail/iframe trees for one workspace. Navigating away
 * only CSS-hides an entry; deletion or a page refresh is what releases it.
 */
export function AirAppKeepAliveHost({
  activeSlug,
  enabled = true,
  fallback,
  orpc,
  renderer: RenderDetail,
  scopeKey,
}: AirAppKeepAliveHostProps) {
  const registeredSlugs = useAirAppKeepAliveStore((state) => state.scopes[scopeKey] ?? EMPTY_SLUGS);

  useEffect(() => {
    if (enabled && activeSlug) {
      useAirAppKeepAliveStore.getState().register(scopeKey, activeSlug);
    }
  }, [activeSlug, enabled, scopeKey]);

  if (!enabled || !RenderDetail) {
    return fallback;
  }

  // Mount a newly selected slug in the same render that selected it. The
  // effect registers it globally for subsequent routes without a disposable
  // intermediate detail tree or iframe navigation.
  const mountedSlugs =
    activeSlug && !registeredSlugs.includes(activeSlug)
      ? [...registeredSlugs, activeSlug]
      : registeredSlugs;

  return (
    <>
      {!activeSlug ? fallback : null}
      {mountedSlugs.map((slug) => (
        <div
          aria-hidden={slug !== activeSlug}
          className={slug === activeSlug ? "h-full" : "hidden"}
          data-airapp-keepalive-scope={scopeKey}
          data-dashboard-airapp-view={slug}
          key={`${scopeKey}:${slug}`}
        >
          <AirAppKeepAliveActiveContext.Provider value={slug === activeSlug}>
            <AirAppKeepAliveScopeContext.Provider value={scopeKey}>
              <RenderDetail orpc={orpc} slug={slug} />
            </AirAppKeepAliveScopeContext.Provider>
          </AirAppKeepAliveActiveContext.Provider>
        </div>
      ))}
    </>
  );
}
