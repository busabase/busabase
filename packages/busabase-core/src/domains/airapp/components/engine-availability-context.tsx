"use client";

import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";
import { createContext, type ReactNode, useContext } from "react";

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
 * The default is the one engine that is always available: Nodepod runs in the
 * page itself, so it needs nothing configured. A host that passes nothing gets
 * exactly that, which is a safe floor rather than an optimistic guess.
 */
const AirAppEngineAvailabilityContext = createContext<AirAppRunnerKind[]>(["nodepod"]);

interface AirAppEngineAvailabilityProviderProps {
  children: ReactNode;
  engines?: AirAppRunnerKind[];
}

export function AirAppEngineAvailabilityProvider({
  children,
  engines,
}: AirAppEngineAvailabilityProviderProps) {
  return (
    <AirAppEngineAvailabilityContext.Provider value={engines ?? ["nodepod"]}>
      {children}
    </AirAppEngineAvailabilityContext.Provider>
  );
}

export function useAirAppEngineAvailability(): AirAppRunnerKind[] {
  return useContext(AirAppEngineAvailabilityContext);
}
