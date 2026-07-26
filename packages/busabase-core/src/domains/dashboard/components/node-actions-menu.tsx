"use client";

// The single "•••" actions menu shared by BOTH the sidebar row (via
// `dashboard-shell.tsx`'s `buildNavItem`, which renders it through
// `openlib/ui/dashboard`'s `NavMain` using the same `NavItemAction[]` shape)
// and every node-detail topbar (this component). Rather than each detail
// page getting its own standalone Rename/Permissions/Share buttons sitting
// side by side, the topbar gets exactly ONE "•••" trigger that opens the
// same kind of dropdown the sidebar row does — same actions, same icons,
// same dialogs underneath (`NodeRenameDialog`/`NodePermissionsDialog`/
// `NodeShareDialog`), just rendered with `kui/dropdown-menu` directly here
// instead of through `NavMain` (a detail page's topbar isn't a sidebar row,
// so it can't reuse `NavMain`'s internal JSX — but it reuses every actual
// *behavior*: the same dialogs, the same mutation calls, the same
// permission-aware rename semantics). Share is omitted only when the caller
// couldn't supply a `nodeSlug` (see `canShare`).
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
import { Globe, MoreHorizontal, Pencil, Shield, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { useIsAnonymousVisitor } from "../visitor-context";
import { NodeDeleteDialog } from "./file-tree-browser";
import { NodeAgentPromptsDialog } from "./node-agent-prompts-dialog";
import { NodePermissionsDialog } from "./node-permissions-button";
import { NodeRenameDialog } from "./node-rename-dialog";
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
  const [renameOpen, setRenameOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Every action in this menu is a write/manage action — a public read-only
  // visitor never sees the trigger at all, same self-gate every individual
  // action button in this domain uses.
  const isAnon = useIsAnonymousVisitor();
  if (isAnon) {
    return null;
  }

  const canRename = nodeType !== "base";
  // NodeShareDialog requires a real slug (it builds the public URL from it);
  // this prop is optional here only because Rename can invalidate its
  // caller's query without one. Every current call site does pass it.
  const canShare = Boolean(nodeSlug);

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
          {canRename && (
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil className="mr-2 size-3.5" />
              {messages.rename.title}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setPermissionsOpen(true)}>
            <Shield className="mr-2 size-3.5" />
            {messages.permissions.title}
          </DropdownMenuItem>
          {canShare && (
            <DropdownMenuItem onSelect={() => setShareOpen(true)}>
              <Globe className="mr-2 size-3.5" />
              {messages.share.title}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setPromptsOpen(true)}>
            <Sparkles className="mr-2 size-3.5" />
            {messages.agentPrompts.title}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)} variant="destructive">
            <Trash2 className="mr-2 size-3.5" />
            {messages.nodeDetail.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {renameOpen && canRename && (
        <NodeRenameDialog
          nodeId={nodeId}
          nodeName={nodeName}
          nodeSlug={nodeSlug}
          onOpenChange={setRenameOpen}
          onRenamed={onRenamed}
          open={renameOpen}
          orpc={orpc}
        />
      )}
      {permissionsOpen && (
        <NodePermissionsDialog
          nodeId={nodeId}
          nodeName={nodeName}
          onOpenChange={setPermissionsOpen}
          open={permissionsOpen}
          orpc={orpc}
        />
      )}
      {promptsOpen && (
        <NodeAgentPromptsDialog
          nodeId={nodeId}
          nodeName={nodeName}
          nodeType={nodeType}
          onOpenChange={setPromptsOpen}
          open={promptsOpen}
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
