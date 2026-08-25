"use client";

// The seam that lets `NodeSettingsDialog`'s Permissions tab exist WITHOUT
// busabase-core knowing anything about permissions. Permissions management
// (member picker, visibility switch, pending access-requests review) is
// cloud-only product surface — busabase-core is what ships in the
// open-source, single-user `apps/busabase`, and packaging that UI there would
// put member/space-membership concepts into a build that has no such thing.
//
// A multi-tenant host renders its own `NodePermissionsPanel` through this
// provider; the open-source host renders nothing, so `useContext` resolves to
// the default `null` and `NodeSettingsDialog` simply omits the Permissions tab
// from its tab list — not a disabled/empty tab, an ABSENT one, so a single-user
// install never sees a control it can't use.
//
// Same "host injects, core consumes" pattern the old `NodePermissionsDialog`
// used for `SpaceMembersProvider`/`SpaceVisibilityModeProvider`
// /`NodeAccessRequestsProvider` — collapsed into ONE slot here because the
// cloud panel now owns fetching its own members/visibility-mode/access-request
// data directly (it has `cloudOrpc` in scope), rather than three separate
// values threaded down through busabase-core.
import { createContext } from "react";

export type RenderNodeSettingsPermissionsPanel = (
  nodeId: string,
  nodeName: string,
) => React.ReactNode;

const NodeSettingsPermissionsSlotContext = createContext<RenderNodeSettingsPermissionsPanel | null>(
  null,
);

export const NodeSettingsPermissionsSlotProvider = NodeSettingsPermissionsSlotContext.Provider;
export { NodeSettingsPermissionsSlotContext };
