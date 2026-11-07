"use client";

import { Button } from "kui/button";
import { Pin } from "lucide-react";
import { useCoreI18n } from "../../../i18n";
import { useSidePanelStore } from "../store/side-panel-store";

/**
 * Shared side-panel tab id convention: `${nodeType}-${nodeId}` — mirrors
 * `airAppSidePanelTabId` (which predates this and stays `airapp-${nodeId}`
 * for backward compat with any already-open AirApp tabs).
 */
export const nodeSidePanelTabId = (nodeType: string, nodeId: string) => `${nodeType}-${nodeId}`;

/**
 * Pin-to-side-panel trigger reused by every node-detail header (Base, Doc,
 * File, Drive, Skill, Folder — AirApp has its own richer version in
 * `AirAppRunControls` since it also toggles a live preview run). Purely
 * dispatches `openTab`; the actual side-panel content comes from whatever
 * renderer is registered for `tabType` via `registerSidePanelTab`.
 *
 * Hidden below `sm`. On a phone the side panel opens as a full-screen overlay,
 * so pinning the node you are looking at only covers it with a second copy of
 * itself — and the button cost the topbar the room it needed: on a Workflow it
 * pushed the side-panel toggle past the right edge of a 390px screen.
 */
export function NodePinButton({
  tabId,
  tabType,
  title,
  payload,
}: {
  tabId: string;
  tabType: string;
  title: string;
  payload: unknown;
}) {
  const messages = useCoreI18n();
  return (
    <Button
      aria-label={messages.nodeDetail.pinToSidePanel}
      className="size-8 text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground max-sm:hidden"
      onClick={() =>
        useSidePanelStore.getState().openTab({ id: tabId, type: tabType, title, payload })
      }
      size="icon"
      title={messages.nodeDetail.pinToSidePanel}
      type="button"
      variant="ghost"
    >
      <Pin className="size-3.5" />
    </Button>
  );
}
