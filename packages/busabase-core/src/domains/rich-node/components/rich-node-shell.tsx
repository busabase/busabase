"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeContentInput } from "busabase-contract/contract/node-content-schemas";
import type { ChangeRequestStatus, NodeVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Save } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { NodeActionsMenu } from "../../dashboard/components/node-actions-menu";
import { NodeAgentPromptsButton } from "../../dashboard/components/node-agent-prompts-button";
import { NodePinButton, nodeSidePanelTabId } from "../../dashboard/components/node-pin-button";
import {
  FullscreenPreviewSurface,
  PreviewFullscreenButton,
  type PreviewFullscreenState,
} from "../../dashboard/components/preview-fullscreen";
import { changeRequestStatusLabel } from "../../dashboard/helpers/change-request";
import { useHrefWithCurrentSearch } from "../../dashboard/helpers/link-search";
import { useRegisterTopbarNodeActions } from "../../dashboard/hooks/use-register-topbar-node-actions";
import { useRegisterTopbarNodeInfo } from "../../dashboard/hooks/use-register-topbar-node-info";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import { stableStringify } from "../utils/stable-json";

export type SaveStatus =
  | "saved"
  | "dirty"
  | "saving"
  | "error"
  | Exclude<ChangeRequestStatus, "merged">;

const isReviewStatus = (status: SaveStatus) =>
  status !== "saved" && status !== "dirty" && status !== "saving" && status !== "error";

export const richNodeSaveStatusLabel = (
  status: SaveStatus,
  messages: ReturnType<typeof useCoreI18n>,
) =>
  status === "saving"
    ? messages.richNodes.saving
    : status === "saved"
      ? messages.richNodes.saved
      : isReviewStatus(status)
        ? changeRequestStatusLabel(status, messages)
        : messages.richNodes.unsaved;

export function useNodeContentSave(
  orpc: BusabaseQueryUtils,
  node: NodeVO | null,
  kind: "whiteboard" | "workflow" | "html",
) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  const mutation = useMutation(orpc.nodes.updateContent.mutationOptions());
  const nodeId = node?.id ?? null;
  const sessionRef = useRef({ nodeId, revision: 0, pending: false });
  if (sessionRef.current.nodeId !== nodeId) {
    sessionRef.current = { nodeId, revision: 0, pending: false };
  }
  const session = sessionRef.current;
  const [state, setState] = useState<{
    session: typeof session;
    status: SaveStatus;
    error: string | null;
    reviewRequestId: string | null;
  }>({ session, status: "saved", error: null, reviewRequestId: null });
  const status = state.session === session ? state.status : "saved";
  const error = state.session === session ? state.error : null;
  const reviewRequestId = state.session === session ? state.reviewRequestId : null;
  const reviewQuery = useQuery({
    ...(reviewRequestId
      ? orpc.changeRequests.get.queryOptions({ input: { changeRequestId: reviewRequestId } })
      : { queryKey: ["rich-node-save-review", nodeId], queryFn: async () => null, enabled: false }),
    refetchInterval: (query) =>
      reviewRequestId &&
      (!query.state.data?.status || ["in_review", "approved"].includes(query.state.data.status))
        ? 5_000
        : false,
  });

  useEffect(() => {
    const reviewedStatus = reviewQuery.data?.status;
    if (!nodeId || !reviewRequestId || !reviewedStatus) return;
    if (reviewedStatus !== "merged") {
      setState((current) =>
        current.session === session &&
        current.reviewRequestId === reviewRequestId &&
        isReviewStatus(current.status) &&
        current.status !== reviewedStatus
          ? { ...current, status: reviewedStatus }
          : current,
      );
      return;
    }
    let active = true;
    const finishReview = async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.nodes.get.key() });
      if (!active || sessionRef.current !== session) return;
      setState((current) =>
        current.session === session && current.reviewRequestId === reviewRequestId
          ? {
              ...current,
              status: isReviewStatus(current.status) ? "saved" : current.status,
              reviewRequestId: null,
            }
          : current,
      );
    };
    void finishReview();
    return () => {
      active = false;
    };
  }, [nodeId, orpc, queryClient, reviewQuery.data?.status, reviewRequestId, session]);

  const markDirty = useCallback(() => {
    if (sessionRef.current !== session) return;
    session.revision += 1;
    setState((current) => ({
      session,
      status: session.pending ? "saving" : "dirty",
      error: null,
      reviewRequestId: current.session === session ? current.reviewRequestId : null,
    }));
  }, [session]);

  const save = useCallback(
    async (document: unknown) => {
      if (!node || session.pending || sessionRef.current !== session) return false;
      session.pending = true;
      const savedRevision = session.revision;
      setState((current) => ({
        session,
        status: "saving",
        error: null,
        reviewRequestId: current.session === session ? current.reviewRequestId : null,
      }));
      try {
        // `kind` is one of three literals here (not narrowed to a single one,
        // since this hook is shared by all three rich-node editors), so `{
        // kind, document }` doesn't line up with `content`'s discriminated
        // union on its own — the caller is what guarantees `document` actually
        // matches `kind`'s shape (each editor only ever calls its own `save`).
        const result = await mutation.mutateAsync({
          nodeId: node.id,
          content: { kind, document } as NodeContentInput,
        });
        // Rich-node editors read the detail query, not the sidebar tree. Mark
        // both stale so returning to a board cannot mount its pre-save scene.
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.nodes.list.queryOptions({}).queryKey,
          }),
          queryClient.invalidateQueries({
            // Detail URLs may use either the ID or slug of the same node.
            queryKey: orpc.nodes.get.key(),
          }),
        ]);
        if (sessionRef.current === session) {
          setState({
            session,
            status:
              session.revision !== savedRevision
                ? "dirty"
                : result.status === "merged"
                  ? "saved"
                  : "in_review",
            error: null,
            reviewRequestId: result.status === "merged" ? null : result.id,
          });
        }
        return true;
      } catch (caught) {
        if (sessionRef.current === session) {
          setState({
            session,
            status: "error",
            error: presentCoreError(messages, locale, caught, messages.richNodes.saveFailed),
            reviewRequestId: null,
          });
        }
        return false;
      } finally {
        session.pending = false;
      }
    },
    [messages, locale, kind, mutation, node, orpc, queryClient, session],
  );

  return { error, markDirty, reviewRequestId, save, status };
}

export function RichNodeReviewLink({ requestId }: { requestId: string }) {
  const messages = useCoreI18n();
  const href = useHrefWithCurrentSearch(`/inbox/${requestId}`);
  return (
    <Link className="text-primary text-xs underline-offset-2 hover:underline" href={href}>
      {messages.inbox.title}
    </Link>
  );
}

interface ServerDocumentSyncOptions<TDocument> {
  /** Push the server's document into the editor (setState, `updateScene`, …). */
  apply: (document: TDocument) => void;
  /** The document as the editor currently holds it, in the same shape as `serverDocument`. */
  getLocalDocument: () => unknown;
  node: NodeVO | null;
  /** The document returned by the node detail query. */
  serverDocument: TDocument;
  status: SaveStatus;
}

/**
 * Keep an open rich-node editor in step with the server when the document
 * changes underneath it — another browser tab, another member, an agent
 * saving node content through the API, or an MCP tool.
 *
 * Every rich-node editor (whiteboard/workflow/HTML) seeds its state from
 * the detail document exactly ONCE, at mount: Excalidraw is uncontrolled and reads
 * `initialData` only when it mounts, and the workflow/HTML editors pass their
 * parsed document straight into `useState`/`useNodesState` initializers. So a
 * refetched node tree updated the React Query cache and the canvas kept
 * showing the stale drawing — the change was invisible until a full page
 * reload. This hook closes that gap.
 *
 * Three guards, each earning its place:
 *  - `status === "saved"`: local unsaved work always wins. A background
 *    refetch must never overwrite something the user is still drawing.
 *  - The server document must change from the last server version we observed.
 *    Immediately after a save the cache may still hold the old document. It
 *    must not overwrite the newly saved local scene. Content is stored outside
 *    the node row, so a fresh document can have the SAME node.updatedAt.
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
  const serverVersion = stableStringify(serverDocument);
  const syncedNodeIdRef = useRef(nodeId);
  const syncedServerVersionRef = useRef<string | null>(serverVersion);
  // ISO-8601 UTC strings compare correctly lexicographically, so no Date parse.
  const syncedUpdatedAtRef = useRef<string | null>(updatedAt);
  if (syncedNodeIdRef.current !== nodeId) {
    // A different node behind the same mounted editor: nothing has been synced
    // for it yet, so let the content check below decide (its `updatedAt` may
    // well be OLDER than the previous node's).
    syncedNodeIdRef.current = nodeId;
    syncedUpdatedAtRef.current = null;
    syncedServerVersionRef.current = null;
  }

  useEffect(() => {
    if (!nodeId || !updatedAt || status !== "saved") return;
    const syncedUpdatedAt = syncedUpdatedAtRef.current;
    if (syncedUpdatedAt !== null && updatedAt < syncedUpdatedAt) return;
    syncedUpdatedAtRef.current = updatedAt;
    if (serverVersion === syncedServerVersionRef.current) return;
    syncedServerVersionRef.current = serverVersion;
    if (serverVersion === stableStringify(getLocalDocumentRef.current())) return;
    applyRef.current(serverDocument);
  }, [nodeId, serverDocument, serverVersion, status, updatedAt]);
}

interface RichNodeShellProps {
  node: NodeVO;
  nodeType: string;
  orpc: BusabaseQueryUtils;
  status: SaveStatus;
  error?: string | null;
  reviewRequestId?: string | null;
  onSave: () => void;
  children: ReactNode;
  actions?: ReactNode;
  fullscreenState: PreviewFullscreenState;
}

export function RichNodeShell({
  node,
  nodeType,
  orpc,
  status,
  error,
  reviewRequestId,
  onSave,
  children,
  actions,
  fullscreenState,
}: RichNodeShellProps) {
  const messages = useCoreI18n();
  const isAnonymous = useIsAnonymousVisitor();
  const statusLabel = richNodeSaveStatusLabel(status, messages);

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
        {reviewRequestId ? <RichNodeReviewLink requestId={reviewRequestId} /> : null}
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
              disabled={
                status === "saving" ||
                status === "saved" ||
                status === "in_review" ||
                status === "approved"
              }
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
  useRegisterTopbarNodeInfo({
    description: node.description,
    nodeId: node.id,
    nodeName: node.name,
    nodeSlug: node.slug,
    nodeType,
    orpc,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
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
