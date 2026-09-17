"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeContentInput } from "busabase-contract/contract/node-content-schemas";
import type { NodeVO } from "busabase-contract/types";
import { Button } from "kui/button";
import type { LucideIcon } from "lucide-react";
import { Info, Save } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { NodeActionsMenu } from "../../dashboard/components/node-actions-menu";
import { NodeAgentPromptsButton } from "../../dashboard/components/node-agent-prompts-button";
import { NodePinButton, nodeSidePanelTabId } from "../../dashboard/components/node-pin-button";
import { NodeSettingsDialog } from "../../dashboard/components/node-settings-dialog";
import {
  FullscreenPreviewSurface,
  PreviewFullscreenButton,
  type PreviewFullscreenState,
} from "../../dashboard/components/preview-fullscreen";
import { useRegisterTopbarNodeActions } from "../../dashboard/hooks/use-register-topbar-node-actions";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import { stableStringify } from "../utils/stable-json";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

export function useNodeContentSave(
  orpc: BusabaseQueryUtils,
  node: NodeVO | null,
  kind: "whiteboard" | "workflow" | "html",
) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  const mutation = useMutation(orpc.nodes.updateContent.mutationOptions());
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);

  const markDirty = useCallback(() => {
    setStatus((current) => (current === "saving" ? current : "dirty"));
    setError(null);
  }, []);

  const save = useCallback(
    async (document: unknown) => {
      if (!node || mutation.isPending) return false;
      setStatus("saving");
      setError(null);
      try {
        // `kind` is one of three literals here (not narrowed to a single one,
        // since this hook is shared by all three rich-node editors), so `{
        // kind, document }` doesn't line up with `content`'s discriminated
        // union on its own — the caller is what guarantees `document` actually
        // matches `kind`'s shape (each editor only ever calls its own `save`).
        await mutation.mutateAsync({
          nodeId: node.id,
          content: { kind, document } as NodeContentInput,
        });
        await queryClient.invalidateQueries({
          queryKey: orpc.nodes.list.queryOptions({}).queryKey,
        });
        setStatus("saved");
        return true;
      } catch (caught) {
        setStatus("error");
        setError(presentCoreError(messages, locale, caught, messages.richNodes.saveFailed));
        return false;
      }
    },
    [messages, locale, kind, mutation, node, orpc, queryClient],
  );

  return { error, markDirty, save, status };
}

interface ServerDocumentSyncOptions<TDocument> {
  /** Push the server's document into the editor (setState, `updateScene`, …). */
  apply: (document: TDocument) => void;
  /** The document as the editor currently holds it, in the same shape as `serverDocument`. */
  getLocalDocument: () => unknown;
  node: NodeVO | null;
  /** The document as it currently exists on the server (parsed from `node.metadata`). */
  serverDocument: TDocument;
  status: SaveStatus;
}

/**
 * Keep an open rich-node editor in step with the server when the document
 * changes underneath it — another browser tab, another member, an agent
 * calling `PATCH /api/v1/nodes/{nodeId}/metadata`, or an MCP tool.
 *
 * Every rich-node editor (whiteboard/workflow/HTML) seeds its state from
 * `node.metadata` exactly ONCE, at mount: Excalidraw is uncontrolled and reads
 * `initialData` only when it mounts, and the workflow/HTML editors pass their
 * parsed document straight into `useState`/`useNodesState` initializers. So a
 * refetched node tree updated the React Query cache and the canvas kept
 * showing the stale drawing — the change was invisible until a full page
 * reload. This hook closes that gap.
 *
 * Three guards, each earning its place:
 *  - `status === "saved"`: local unsaved work always wins. A background
 *    refetch must never overwrite something the user is still drawing.
 *  - `updatedAt` must be strictly newer than the last version we synced. This
 *    covers the window right after a save, where the mutation has committed but
 *    the tree query still holds the pre-save node — without it, that stale copy
 *    would be applied straight back over the just-saved work.
 *  - the incoming document must differ from what the editor already holds
 *    (compared with `stableStringify`, since jsonb reorders keys). Re-applying
 *    an identical document would needlessly reset selection and undo history.
 */
export function useServerDocumentSync<TDocument>({
  apply,
  getLocalDocument,
  node,
  serverDocument,
  status,
}: ServerDocumentSyncOptions<TDocument>) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const getLocalDocumentRef = useRef(getLocalDocument);
  getLocalDocumentRef.current = getLocalDocument;

  const nodeId = node?.id ?? null;
  const updatedAt = node?.updatedAt ?? null;
  const syncedNodeIdRef = useRef(nodeId);
  // ISO-8601 UTC strings compare correctly lexicographically, so no Date parse.
  const syncedUpdatedAtRef = useRef<string | null>(updatedAt);
  if (syncedNodeIdRef.current !== nodeId) {
    // A different node behind the same mounted editor: nothing has been synced
    // for it yet, so let the content check below decide (its `updatedAt` may
    // well be OLDER than the previous node's).
    syncedNodeIdRef.current = nodeId;
    syncedUpdatedAtRef.current = null;
  }

  useEffect(() => {
    if (!updatedAt || status !== "saved") return;
    const syncedUpdatedAt = syncedUpdatedAtRef.current;
    if (syncedUpdatedAt !== null && updatedAt <= syncedUpdatedAt) return;
    syncedUpdatedAtRef.current = updatedAt;
    if (stableStringify(serverDocument) === stableStringify(getLocalDocumentRef.current())) return;
    applyRef.current(serverDocument);
  }, [serverDocument, status, updatedAt]);
}

interface RichNodeShellProps {
  node: NodeVO;
  nodeType: string;
  icon: LucideIcon;
  orpc: BusabaseQueryUtils;
  status: SaveStatus;
  error?: string | null;
  onSave: () => void;
  children: ReactNode;
  actions?: ReactNode;
  fullscreenState: PreviewFullscreenState;
}

export function RichNodeShell({
  node,
  nodeType,
  icon: Icon,
  orpc,
  status,
  error,
  onSave,
  children,
  actions,
  fullscreenState,
}: RichNodeShellProps) {
  const messages = useCoreI18n();
  const isAnonymous = useIsAnonymousVisitor();
  const [infoOpen, setInfoOpen] = useState(false);
  const statusLabel =
    status === "saving"
      ? messages.richNodes.saving
      : status === "saved"
        ? messages.richNodes.saved
        : messages.richNodes.unsaved;

  useRegisterTopbarNodeActions(
    isAnonymous ? null : (
      <>
        {!isAnonymous && (
          <span
            className={
              status === "error"
                ? "hidden max-w-48 truncate text-destructive text-xs sm:block"
                : "hidden text-muted-foreground text-xs sm:block"
            }
            title={error ?? statusLabel}
          >
            {error ?? statusLabel}
          </span>
        )}
        {!isAnonymous && actions}
        <NodePinButton
          payload={{ nodeId: node.id }}
          tabId={nodeSidePanelTabId(nodeType, node.id)}
          tabType={`${nodeType}-preview`}
          title={node.name}
        />
        <PreviewFullscreenButton
          fullscreenState={fullscreenState}
          label={messages.airapp.enterFullscreen}
        />
        {!isAnonymous && (
          <NodeAgentPromptsButton
            orpc={orpc}
            nodeId={node.id}
            nodeName={node.name}
            nodeType={nodeType}
          />
        )}
        {/* One "•••" menu instead of the Permissions + Delete button pair this
            header used to render — same set of actions (plus Rename/Share,
            which this header never offered at all), same dialogs, and it
            matches every other node-detail topbar. The icon-only/labelled
            responsive split the Permissions button needed is gone with it: the
            trigger is a fixed-size icon at every breakpoint. Agent prompts sits
            outside as its own button (see `NodeAgentPromptsButton`). */}
        {!isAnonymous && (
          <>
            <NodeActionsMenu
              nodeId={node.id}
              nodeName={node.name}
              nodeSlug={node.slug}
              nodeType={nodeType}
              orpc={orpc}
            />
            <Button
              aria-label={messages.richNodes.save}
              disabled={status === "saving" || status === "saved"}
              onClick={onSave}
              size="icon-sm"
              title={messages.richNodes.save}
              type="button"
              variant="default"
            >
              <Save className="size-3.5" />
            </Button>
          </>
        )}
      </>
    ),
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="shrink-0 border-border/60 border-b px-4 py-4 md:px-6 md:py-5">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-1 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold text-foreground text-xl leading-7">
              {node.name}
            </h1>
            {node.description ? (
              <p
                className="mt-1 line-clamp-2 text-muted-foreground text-sm leading-5 md:line-clamp-1"
                title={node.description}
              >
                {node.description}
              </p>
            ) : null}
          </div>
          <Button
            aria-label={messages.nodeDetail.details}
            className="shrink-0 text-muted-foreground"
            onClick={() => setInfoOpen(true)}
            size="icon-sm"
            title={messages.nodeDetail.details}
            type="button"
            variant="ghost"
          >
            <Info className="size-3.5" />
          </Button>
          {infoOpen ? (
            <NodeSettingsDialog
              initialTab="info"
              nodeId={node.id}
              nodeName={node.name}
              nodeSlug={node.slug}
              nodeType={nodeType}
              onOpenChange={setInfoOpen}
              open
              orpc={orpc}
            />
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <FullscreenPreviewSurface
          data-visual-node-preview={nodeType}
          exitLabel={messages.airapp.exitFullscreen}
          fullscreenState={fullscreenState}
        >
          {children}
        </FullscreenPreviewSurface>
      </div>
    </div>
  );
}

export function RichNodeNotFound({ type }: { type: string }) {
  const messages = useCoreI18n();
  return (
    <div className="flex h-full items-center justify-center bg-background p-6 text-muted-foreground text-sm">
      {fmt(messages.richNodes.notFound, { type })}
    </div>
  );
}
