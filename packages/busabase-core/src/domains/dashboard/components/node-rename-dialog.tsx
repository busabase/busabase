"use client";

// The Rename dialog for a Folder/Drive/Doc/File/Skill/AirApp node. Base nodes
// keep their own independent rename path (`base-views.tsx` Design Tab →
// `submitRenameBase` in `dashboard/index.tsx`) — this dialog is never wired
// for `node.type === "base"`.
//
// Deliberately just the dialog, no standalone trigger button — every entry
// point (sidebar "•••" menu and each node-detail topbar's "•••" menu) opens
// THIS dialog from within its own shared actions menu (see
// `node-actions-menu.tsx`), so there's exactly one place that owns "what a
// rename request looks like" and no second copy of the submit logic sitting
// behind a lone toolbar button.
//
// Submitting reuses the generic `nodes.createChangeRequest` endpoint with a
// `kind: "rename"` operation, same as the Base rename flow, and offers the
// same permission-aware choice via `SplitSubmitButton`: "Rename now"
// (approve + merge immediately) vs "Request rename" (submit for review) —
// which of the two is primary is decided by `resolveSubmitActionOrder` from
// the caller's API-key permission level, not by this component.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { useState } from "react";
import { toast } from "sonner";
import { useCoreI18n } from "../../../i18n";
import { SplitSubmitButton } from "./split-submit-button";

export function NodeRenameDialog({
  orpc,
  nodeId,
  nodeName,
  nodeSlug,
  open,
  onOpenChange,
  onRenamed,
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeName: string;
  /**
   * The node's route slug (e.g. `live-race-folder`), if the caller has it.
   * Every detail-page query (`folders.get`/`docs.get`/`files.get`/
   * `skills.get`/`drives.get`/`airapp.get`) is keyed by the ROUTE SLUG, not
   * the database node id — despite the input field literally being named
   * `nodeId` in each of those queries' `input: { nodeId: slug }` call sites
   * (`node-detail-views.tsx`/`AirAppDetailView.tsx`). This dialog's own
   * `nodeId` prop is the real database id (needed for the `nodes.rename`
   * mutation itself), which never appears in those query keys — so without
   * also matching on `nodeSlug`, `invalidateNodes` below silently misses
   * every detail page's own query and only the sidebar refreshes. Renaming a
   * node's display `name` never changes its `slug` (a separate, optional
   * field on the same `rename` operation this dialog doesn't send), so the
   * slug is a stable, safe match target across the rename.
   */
  nodeSlug?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed?: (name: string) => void;
}) {
  const messages = useCoreI18n();
  const t = messages.rename;
  const queryClient = useQueryClient();
  const [name, setName] = useState(nodeName);

  const createCr = useMutation(orpc.nodes.createChangeRequest.mutationOptions());
  const reviewCr = useMutation(orpc.changeRequests.review.mutationOptions());
  const mergeCr = useMutation(orpc.changeRequests.merge.mutationOptions());
  const isSaving = createCr.isPending || reviewCr.isPending || mergeCr.isPending;

  // Invalidates BOTH the sidebar's whole-tree query (`nodes.list`, which
  // carries no `nodeId`/`slug` in its own key — it's the one query every
  // rename MUST refresh regardless) AND every detail-page query that happens
  // to be keyed by this node's id OR slug — `folders.get`/`docs.get`/
  // `files.get`/`skills.get`/`drives.get`/`airapp.get`, one per node type,
  // each living in its own domain and each shaped differently. A generic
  // predicate over every cached query key covers all of them in one place
  // without this dialog needing to know which query each caller happens to
  // be reading from (or growing an `onRenamed` per-caller wiring requirement
  // across five+ detail views). Cheap: this only runs once, right after a
  // rename actually commits.
  const invalidateNodes = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.nodes.list.queryOptions({}).queryKey }),
      queryClient.invalidateQueries({
        predicate: (query) => {
          const keyStr = JSON.stringify(query.queryKey);
          return keyStr.includes(nodeId) || (!!nodeSlug && keyStr.includes(nodeSlug));
        },
      }),
    ]);

  const submit = async (options?: { mergeImmediately?: boolean }) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const changeRequest = await createCr.mutateAsync({
        operations: [{ kind: "rename", nodeId, name: trimmed }],
      });
      if (options?.mergeImmediately) {
        await reviewCr.mutateAsync({
          changeRequestIds: [changeRequest.id],
          verdict: "approved",
        });
        await mergeCr.mutateAsync({ changeRequestIds: [changeRequest.id] });
        await invalidateNodes();
        toast.success(t.renamed);
        onRenamed?.(trimmed);
        onOpenChange(false);
        return;
      }
      await invalidateNodes();
      toast.success(t.renameRequestSubmitted);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.failed);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{nodeName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="node-rename-input">{t.nameLabel}</Label>
          <Input
            autoFocus
            id="node-rename-input"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit({ mergeImmediately: true });
            }}
            placeholder={t.namePlaceholder}
            value={name}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <SplitSubmitButton
            changeRequestAction={{
              label: t.requestRename,
              loadingLabel: messages.common.submitting,
              onSubmit: () => submit(),
              isLoading: isSaving,
            }}
            disabled={isSaving || !name.trim()}
            hint={messages.common.requestReviewHint}
            immediateAction={{
              label: t.renameNow,
              loadingLabel: t.renaming,
              onSubmit: () => submit({ mergeImmediately: true }),
              isLoading: isSaving,
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
