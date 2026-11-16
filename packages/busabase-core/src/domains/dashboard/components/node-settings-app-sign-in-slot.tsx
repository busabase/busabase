"use client";

// The seam that lets `NodeSettingsDialog` show a "User sign-in" tab for an
// AirApp WITHOUT busabase-core knowing anything about app users.
//
// App users (the end users of an AirApp website, e.g. a shop's buyers who sign
// in with an email code) are a Cloud-only product surface: busabase-core is
// what ships in the open-source, single-user `apps/busabase`, which has no
// sign-in pool, no code emails and no owner-filtered records. Same "host
// injects, core consumes" pattern as `node-settings-permissions-slot.tsx`:
// a host that has app users renders its own panel through this provider; the
// open-source host renders nothing, `useContext` resolves to `null`, and the
// dialog omits the tab entirely — an absent tab, not a disabled one.
import { createContext } from "react";

export interface NodeSettingsAppSignInSlotArgs {
  nodeId: string;
  nodeName: string;
  /** Close the node settings dialog — e.g. before opening Space settings. */
  closeDialog: () => void;
}

export type RenderNodeSettingsAppSignInPanel = (
  args: NodeSettingsAppSignInSlotArgs,
) => React.ReactNode;

const NodeSettingsAppSignInSlotContext = createContext<RenderNodeSettingsAppSignInPanel | null>(
  null,
);

export const NodeSettingsAppSignInSlotProvider = NodeSettingsAppSignInSlotContext.Provider;
export { NodeSettingsAppSignInSlotContext };
