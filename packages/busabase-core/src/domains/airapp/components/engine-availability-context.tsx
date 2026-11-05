"use client";

import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { type AirAppEnginePlanGate, resolveAirAppEngineOffer } from "../utils/engine-plan-gate";

/**
 * The engines this deployment can offer, resolved on the server and threaded
 * down rather than guessed in the browser.
 *
 * The browser cannot see whether a Sandock API key is configured, and it must
 * not infer availability from the build, the hostname, or anything else — every
 * such guess is wrong in one direction or the other, and the cost of being
 * wrong is a picker that offers an engine which cannot work, discovered only
 * after clicking Run.
 *
 * The default is the one engine that is always available: `browser` runs in the
 * page itself, so it needs nothing configured. A host that passes nothing gets
 * exactly that, which is a safe floor rather than an optimistic guess.
 *
 * A host that sells engines also passes a plan gate. The gate is applied here,
 * once, so every consumer of `useAirAppEngineAvailability` keeps meaning "what
 * this space can run right now" without knowing plans exist; the locked rest is
 * read separately through `useAirAppEnginePlanGate` by the two surfaces that
 * must show it (the engine picker and the Run panel's locked state).
 */
interface AirAppEngineAvailabilityValue {
  engines: AirAppRunnerKind[];
  notConfigured: AirAppRunnerKind[];
  planGate: ResolvedAirAppEnginePlanGate | null;
}

/** A host's plan gate, with its locked list narrowed to engines this deployment actually has. */
export interface ResolvedAirAppEnginePlanGate extends AirAppEnginePlanGate {
  lockedEngines: AirAppRunnerKind[];
}

const DEFAULT_ENGINES: AirAppRunnerKind[] = ["browser"];

const AirAppEngineAvailabilityContext = createContext<AirAppEngineAvailabilityValue>({
  engines: DEFAULT_ENGINES,
  notConfigured: [],
  planGate: null,
});

interface AirAppEngineAvailabilityProviderProps {
  children: ReactNode;
  engines?: AirAppRunnerKind[];
  /** Engines an operator could turn on here. Omitted: none are shown. */
  notConfiguredEngines?: AirAppRunnerKind[];
  /** Host-owned plan gate (Busabase Cloud). Omitted: availability is capability only. */
  planGate?: AirAppEnginePlanGate;
}

export function AirAppEngineAvailabilityProvider({
  children,
  engines,
  notConfiguredEngines,
  planGate,
}: AirAppEngineAvailabilityProviderProps) {
  const value = useMemo<AirAppEngineAvailabilityValue>(() => {
    const offer = resolveAirAppEngineOffer(engines ?? DEFAULT_ENGINES, planGate?.lockedEngines);
    return {
      engines: offer.available,
      notConfigured: notConfiguredEngines ?? [],
      planGate: planGate ? { ...planGate, lockedEngines: offer.locked } : null,
    };
  }, [engines, notConfiguredEngines, planGate]);
  return (
    <AirAppEngineAvailabilityContext.Provider value={value}>
      {children}
    </AirAppEngineAvailabilityContext.Provider>
  );
}

/** Engines this space can run right now — capability, minus anything its plan leaves out. */
export function useAirAppEngineAvailability(): AirAppRunnerKind[] {
  return useContext(AirAppEngineAvailabilityContext).engines;
}

/** Engines an operator could turn on by configuring this deployment. */
export function useAirAppEnginesNotConfigured(): AirAppRunnerKind[] {
  return useContext(AirAppEngineAvailabilityContext).notConfigured;
}

/**
 * The host's plan gate, or `null` where there is none.
 *
 * Non-null with an empty `lockedEngines` is meaningful: the host sells engines
 * and this space has them, but the label and upgrade action are still needed if
 * the server refuses a run the client thought was included.
 */
export function useAirAppEnginePlanGate(): ResolvedAirAppEnginePlanGate | null {
  return useContext(AirAppEngineAvailabilityContext).planGate;
}
