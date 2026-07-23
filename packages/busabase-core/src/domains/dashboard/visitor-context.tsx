"use client";

import { createContext, type ReactNode, useContext } from "react";

/**
 * Who the dashboard is rendering for.
 *
 * `"anonymous"` means a visitor reached this node through a public share link
 * and has NO session at all. The server already enforces that: every anonymous
 * request runs under `runWithAnonymousContext` and is filtered by the
 * per-procedure allowlist in `logic/anonymous-allowlist.ts`, so nothing the
 * client does can widen access.
 *
 * This context exists for the OTHER half of the problem: the dashboard is one
 * component that fires the whole space's queries (`bases.list`,
 * `changeRequests.list`, `auditEvents.list`, `live.subscribe`, …) regardless of
 * which route is showing. For an anonymous visitor every one of those is
 * correctly refused, which produced a wall of 403s and — because the base
 * itself was read out of the refused `bases.list` — an empty page. So the
 * anonymous render has to stop ASKING for space-wide data and read the single
 * shared node instead. Threaded as a prop/context from the server rather than
 * inferred client-side, so an anonymous render can never transiently fire the
 * member queries while a session check resolves.
 */
export type DashboardVisitorKind = "member" | "anonymous";

const DashboardVisitorContext = createContext<DashboardVisitorKind>("member");

interface DashboardVisitorProviderProps {
  children: ReactNode;
  visitorKind: DashboardVisitorKind;
}

export function DashboardVisitorProvider({ children, visitorKind }: DashboardVisitorProviderProps) {
  return (
    <DashboardVisitorContext.Provider value={visitorKind}>
      {children}
    </DashboardVisitorContext.Provider>
  );
}

export const useDashboardVisitorKind = (): DashboardVisitorKind =>
  useContext(DashboardVisitorContext);

/**
 * True when the current render is a public, session-less one.
 *
 * Defaults to false, so every existing host (open source, cloud member,
 * mobile WebView embed) is unaffected unless it opts in explicitly.
 */
export const useIsAnonymousVisitor = (): boolean => useDashboardVisitorKind() === "anonymous";
