"use client";

// The single "•••" actions menu shared by BOTH the sidebar row (via
// `dashboard-shell.tsx`'s `buildNavItem`, which renders it through
// `openlib/ui/dashboard`'s `NavMain` using the same `NavItemAction[]` shape)
// and every node-detail topbar (this component). Rather than each detail
// page getting its own standalone Settings/Rename/Permissions/Share buttons
// sitting side by side, the topbar gets exactly ONE "•••" trigger that opens
// the same kind of dropdown the sidebar row does — same actions, same icons,
// same dialogs underneath (`NodeSettingsDialog`/`NodeShareDialog`), just
// rendered with `kui/dropdown-menu` directly here instead of through
// `NavMain` (a detail page's topbar isn't a sidebar row, so it can't reuse
// `NavMain`'s internal JSX — but it reuses every actual *behavior*: the same
// dialogs, the same mutation calls, the same permission-aware rename
// semantics). Share is omitted only when the caller couldn't supply a
// `nodeSlug` (see `canShare`).
//
// "Settings" and "Rename" are deliberately BOTH here even though they open
// the same dialog on the same General tab. `NodeSettingsDialog` absorbed the
// old standalone Rename dialog, the inline Info popover, and the Permissions
// dialog — so the General tab now holds the node's icon and description too,
// and the Info tab has no other entry point at all. Leaving "Rename" as the
// only way in meant every one of those surfaces was reachable only by
// clicking a menu item that claims to do something else; the label named the
// shortcut and hid the feature. So: "Settings" is the honest entry point (it
// lands neutral, on General), "Rename" stays as the fast path it always was
// (same tab, but it focuses and selects the name field via `focusField`).
// Do not "de-duplicate" these two back into one — the duplication is the
// point, and `focusField` is the only thing that differs.
//
// Delete lives in here too, last, behind a separator and in destructive red.
// It used to be a standalone always-visible toolbar button sitting next to
// this menu, on the theory that a destructive action shouldn't hide in a
// dropdown — but that left every detail topbar rendering a row of four-plus
// naked buttons (Agent prompts / Permissions / Share / Delete on the Base
// page), which is exactly the clutter this menu exists to remove. The confirm
// dialog (`NodeDeleteDialog`) is what actually guards the destruction, and it
// is unchanged; the separator + red text keep the item from being hit by
// muscle memory aimed at the row above it.
//
// Agent prompts is the deliberate exception to that "keep the toolbar to one
// trigger" rule, and it no longer appears here: it is now its own toolbar
// button (`NodeAgentPromptsButton`). For node types with no GUI editor — Form
// most of all — asking your agent IS the edit path, so hiding its entry point
// behind an unlabelled "•••" hid the product. It is in exactly one place per
// toolbar; do not re-add a duplicate item to this menu.
//
// Favorites isn't included here — that action depends on the sidebar's own
// `nodes.listFavorites` cache + toggle context, which isn't naturally
// available to a lone detail page, and Favorites was never part of the
// original ask for this button.

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Globe, History, MoreHorizontal, Pencil, Settings, Shield, Trash2 } from "lucide-react";
import { useContext, useState } from "react";
import { useLocation } from "wouter";
import { useCoreI18n } from "../../../i18n";
import { useIsAnonymousVisitor } from "../visitor-context";
import { NodeDeleteDialog } from "./file-tree-browser";
import { NodeSettingsDialog, type NodeSettingsTab } from "./node-settings-dialog";
import { NodeSettingsPermissionsSlotContext } from "./node-settings-permissions-slot";
import { NodeShareDialog } from "./node-share-button";

export function NodeActionsMenu({
  orpc,
  nodeId,
  nodeName,
  nodeSlug,
  nodeType,
  onRenamed,
  childCount,
  onDeleted,
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeName: string;
  /** The node's route slug — every detail-page `*.get` query is keyed by
   *  this (not the database id), so it's needed to invalidate the CALLING
   *  page's own query after a rename. See `NodeRenameDialog`'s `nodeSlug`
   *  doc for the full "why". */
  nodeSlug?: string;
  /** Base nodes keep their own independent rename path (Design Tab) — the
   *  Rename item is omitted entirely for `nodeType === "base"`. Every other
   *  caller of this component is a non-Base detail view, so this only ever
   *  matters if a future host reuses it for a Base header too. */
  nodeType: string;
  /** Fired after a successful immediate rename (not on a submitted-for-review
   *  request) — lets the detail page refresh its own locally-held name/slug. */
  onRenamed?: (name: string) => void;
  /** Number of descendants, so a folder's delete confirm can warn about the
   *  cascade instead of reading like a single-node delete. */
  childCount?: number;
  /** Fired after a successful delete — e.g. an airapp tearing down its live
   *  Nodepod runner rather than leaking it. */
  onDeleted?: () => void;
}) {
  const messages = useCoreI18n();
  const [, setLocation] = useLocation();
  // Which tab of the one shared `NodeSettingsDialog` is open (and whether to
  // land with the name field focused), or `null` when it's closed — Rename and
  // Permissions used to be two separate dialogs (`NodeRenameDialog`/
  // `NodePermissionsDialog`), now they're tabs of the same one.
  //
  // `focusField` is carried explicitly rather than derived from `tab`, because
  // Settings and Rename both open the SAME General tab and differ only in
  // this: Rename lands with the name selected (it's a rename shortcut),
  // Settings lands neutral (you may well be here for the icon or description).
  const [settings, setSettings] = useState<{
    tab: NodeSettingsTab;
    focusField?: "name";
  } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Permissions is a cloud-only surface — see `node-settings-permissions-slot.tsx`.
  // Absent from the menu entirely (not disabled) when no host injected a panel.
  const hasPermissionsPanel = useContext(NodeSettingsPermissionsSlotContext) !== null;
  // Every action in this menu is a write/manage action — a public read-only
  // visitor never sees the trigger at all, same self-gate every individual
  // action button in this domain uses.
  const isAnon = useIsAnonymousVisitor();
  if (isAnon) {
    return null;
  }

  // Base nodes reach the very same `NodeSettingsDialog` through the Design
  // tab's "Base Info" card → Edit button, so both entries that would open it
  // from here are omitted for them — not because the dialog can't handle a
  // Base, but to keep exactly one entry point per node type.
  const canOpenSettings = nodeType !== "base";
  // NodeShareDialog requires a real slug (it builds the public URL from it);
  // this prop is optional here only because Rename can invalidate its
  // caller's query without one. Every current call site does pass it.
  const canShare = Boolean(nodeSlug);
  // The routed activity sub-page (`/base/:slug/activity` or
  // `/{type}/:slug/activity`, see routes.tsx + use-dashboard-routes.ts) keys
  // off the same slug-or-id every other detail route uses.
  const activityHref = `/${nodeType}/${nodeSlug ?? nodeId}/activity`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={messages.common.moreActions}
            className="size-8"
            size="icon"
            title={messages.common.moreActions}
            type="button"
            variant="outline"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canOpenSettings && (
            <DropdownMenuItem onSelect={() => setSettings({ tab: "general" })}>
              <Settings className="mr-2 size-3.5" />
              {messages.nodeSettings.menuLabel}
            </DropdownMenuItem>
          )}
          {canOpenSettings && (
            <DropdownMenuItem onSelect={() => setSettings({ tab: "general", focusField: "name" })}>
              <Pencil className="mr-2 size-3.5" />
              {messages.rename.title}
            </DropdownMenuItem>
          )}
          {hasPermissionsPanel && (
            <DropdownMenuItem onSelect={() => setSettings({ tab: "permissions" })}>
              <Shield className="mr-2 size-3.5" />
              {messages.permissions.title}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setLocation(activityHref)}>
            <History className="mr-2 size-3.5" />
            {messages.nodeDetail.activity}
          </DropdownMenuItem>
          {canShare && (
            <DropdownMenuItem onSelect={() => setShareOpen(true)}>
              <Globe className="mr-2 size-3.5" />
              {messages.share.title}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)} variant="destructive">
            <Trash2 className="mr-2 size-3.5" />
            {messages.nodeDetail.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {settings && (
        <NodeSettingsDialog
          focusField={settings.focusField}
          initialTab={settings.tab}
          nodeId={nodeId}
          nodeName={nodeName}
          nodeSlug={nodeSlug}
          nodeType={nodeType}
          onOpenChange={(next) => {
            if (!next) setSettings(null);
          }}
          onRenamed={onRenamed}
          open
          orpc={orpc}
        />
      )}
      {deleteOpen && (
        <NodeDeleteDialog
          childCount={childCount}
          nodeId={nodeId}
          nodeName={nodeName}
          nodeType={nodeType}
          onDeleted={onDeleted}
          onOpenChange={setDeleteOpen}
          open={deleteOpen}
          orpc={orpc}
        />
      )}
      {shareOpen && canShare && nodeSlug && (
        <NodeShareDialog
          nodeId={nodeId}
          nodeName={nodeName}
          nodeSlug={nodeSlug}
          nodeType={nodeType}
          onOpenChange={setShareOpen}
          open={shareOpen}
          orpc={orpc}
        />
      )}
    </>
  );
}
