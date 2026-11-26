"use client";

import { useSidePanelStore } from "../../dashboard/store/side-panel-store";
import { airAppSidePanelTabId, useAirAppKeepAliveStore } from "./airapp-keepalive-store";
import { useAirAppRunnerStore } from "./airapp-runner-store";

/** Releases every page-lifetime resource owned by a successfully deleted AirApp. */
export const disposeDeletedAirAppSession = ({
  keepAliveScopeKey,
  nodeId,
  routeSlug,
}: {
  keepAliveScopeKey?: string;
  nodeId: string;
  routeSlug: string;
}) => {
  useAirAppRunnerStore.getState().disposeEntry(nodeId);
  const keepAliveStore = useAirAppKeepAliveStore.getState();
  if (keepAliveScopeKey) {
    keepAliveStore.release(keepAliveScopeKey, routeSlug);
  } else {
    keepAliveStore.releaseSlug(routeSlug);
  }
  useSidePanelStore.getState().closeTab(airAppSidePanelTabId(nodeId));
};
