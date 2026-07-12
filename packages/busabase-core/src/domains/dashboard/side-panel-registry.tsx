import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { ReactNode } from "react";

/**
 * Per-platform (web) side-panel tab renderer registry. Each domain registers
 * its side-panel content via `registerSidePanelTab(type, Component)`, and
 * `SidePanel` (components/side-panel.tsx) looks the component up by tab type
 * instead of hardcoding a branch — mirrors `node-detail-registry.tsx`.
 */

export interface SidePanelTabProps {
  orpc: BusabaseQueryUtils;
  payload: unknown;
}

export type SidePanelTabRenderer = (props: SidePanelTabProps) => ReactNode;

const renderers = new Map<string, SidePanelTabRenderer>();

export const registerSidePanelTab = (type: string, renderer: SidePanelTabRenderer): void => {
  renderers.set(type, renderer);
};

export const getSidePanelTab = (type: string): SidePanelTabRenderer | undefined =>
  renderers.get(type);
