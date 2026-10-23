import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { WhiteboardDocument } from "busabase-contract/domains/rich-node/types";
import type {
  AssetAttachmentRef,
  BaseFieldVO,
  BaseVO,
  ChangeRequestVO,
  LookupComputedVO,
  NodeVO,
  RecordVO,
  UserRefVO,
} from "busabase-contract/types";
import { Button } from "kui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { Input } from "kui/input";
import {
  Box,
  Check,
  ChevronRight,
  Copy,
  Eye,
  GitMerge,
  History,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  RotateCcw,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n, useCoreLocale, useIString } from "../../../i18n";
import { localizeCoreErrorMessage, presentCoreError } from "../../../i18n/localize-error";
import { validateRecordFields } from "../../base/field-rules";
import {
  fieldDisplayKind,
  fieldInputKind,
  getMemberIds,
  isHiddenOnCreate,
  isPeopleFieldType,
  isReadOnlyFieldDef,
  isReverseRelationDef,
} from "../../base/field-types";
import { buildFieldGraph } from "../../base/formula/dependency";
import { applyRollup, isRollupCompatible } from "../../base/lookup/rollup";
import { getDateFieldOptions } from "../../base/utils/date-value";
import { parseWhiteboardFieldValue } from "../../base/utils/whiteboard-value";
import {
  getChangeRequestTitle,
  getOperationLabel,
  getRecordTitle,
  isDerivedFieldSlug,
  operationMeta,
} from "../helpers/change-request";
import {
  defaultNewFieldValue,
  getAttachmentRefs,
  getEditorFieldValue,
  getFieldChipEntries,
  getRelationRecordIds,
  getSafeAttachmentUrl,
  isRecordLongField,
} from "../helpers/field";
import {
  fieldValueToString,
  formatAttachmentSize,
  formatDetailTime,
  formatFullTime,
  formatUserRefLabel,
  shortIdentifier,
} from "../helpers/format";
import { mergeSearchIntoHref, useHrefWithCurrentSearch } from "../helpers/link-search";
import { emptyLookupValues } from "../helpers/lookup";
import type { RecordSubmitOptions } from "../helpers/view-types";
import { useDashboardOrpc } from "../orpc-context";
import { registerSidePanelTab, type SidePanelTabProps } from "../side-panel-registry";
import { dashboardNodeShareUrl } from "../utils/share-url";
import { useIsAnonymousVisitor } from "../visitor-context";
import { renderMentionedText } from "./comments";
import { DateFieldInput } from "./date-field";
import { FieldHelp, hasFieldHelp } from "./field-help";
import {
  FieldBadgeList,
  FieldValuePreview,
  HtmlFieldPreview,
  LookupFieldValue,
  MarkdownFieldPreview,
} from "./field-preview";
import { UserRefButton } from "./identity";
import { DialogContent } from "./localized-dialog-content";
import { MemberChips, MemberFieldEditor } from "./member-field";
import { NodeAgentPromptsButton } from "./node-agent-prompts-button";
import { NodeAgentPromptsDialog } from "./node-agent-prompts-dialog";
import { NodePinButton, nodeSidePanelTabId } from "./node-pin-button";
import {
  BusabaseSidePanel,
  ConfirmActionDialog,
  EmptyState,
  RailToggleButton,
  SidebarPanel,
  SidebarRow,
  StatusBadge,
} from "./primitives";
import { RelationFieldEditor } from "./relation-field";
import { ShareLinkActions } from "./share-link-actions";
import { ShimmerSkeleton as Skeleton } from "./shimmer-skeleton";
import { WhiteboardContentSkeleton } from "./skeletons";
import { SplitSubmitButton } from "./split-submit-button";

// Record view/edit mode switch — lives in the titlebar (far right), mirroring the
// base detail's Records/Design switch.
export function RecordTopbarActions({
  activeTab,
  base,
  record,
  recordId,
}: {
  activeTab: "view" | "edit";
  base: BaseVO;
  /** Only used to title the Agent prompts dialog; the prompt itself is keyed on
   *  `recordId`, which is always known even before the record has loaded. */
  record?: RecordVO | null;
  recordId: string;
}) {
  const messages = useCoreI18n();
  const currentSearch = useSearch();
  const isAnon = useIsAnonymousVisitor();
  return (
    <div className="flex items-center gap-2">
      {/* Record-scoped Agent prompts. The View/Edit switch next to it is the
          record's whole toolbar, so this is the only place a per-record "ask my
          agent to fix THIS row" entry point can live. A node's custom scenario
          prompts only ever replace the WHOLE-NODE dialog's scenario tier, never
          a record/cell-scoped one (see `buildNodeAgentPrompts`'s `scope.kind`
          check), so the dialog's scope gate skips that fetch. The chevron's
          "Ask Agent directly" dropdown and the dialog's existing handoff are
          unrelated to scope, so `NodeAgentPromptsButton` resolves them from the
          `DashboardOrpcProvider` shared by every node-detail toolbar. */}
      <NodeAgentPromptsButton
        orpc={null}
        nodeId={base.nodeId}
        nodeName={base.name}
        nodeType="base"
        scope={{
          kind: "record",
          recordId,
          recordTitle: record ? getRecordTitle(record, messages) : undefined,
        }}
      />
      {record && !isAnon ? (
        <NodePinButton
          payload={{ recordId }}
          tabId={nodeSidePanelTabId("record", recordId)}
          tabType="record-preview"
          title={getRecordTitle(record, messages)}
        />
      ) : null}
      <nav className="flex rounded-md bg-muted/60 p-0.5 text-xs">
        <Link
          className={`rounded px-2.5 py-1.5 font-medium transition-colors ${
            activeTab === "view"
              ? "bg-card text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          href={mergeSearchIntoHref(`/base/${base.slug}/${recordId}`, currentSearch)}
        >
          {messages.recordView.view}
        </Link>
        <Link
          className={`rounded px-2.5 py-1.5 font-medium transition-colors ${
            activeTab === "edit"
              ? "bg-card text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          href={mergeSearchIntoHref(`/base/${base.slug}/${recordId}/edit`, currentSearch)}
        >
          {messages.recordView.edit}
        </Link>
      </nav>
    </div>
  );
}

/**
 * A pinned Record deliberately renders a compact, canonical snapshot instead
 * of nesting the full Record Detail route inside the side panel. The full page
 * includes comments, destructive actions, and its own metadata rail; none of
 * those belong in a narrow persistent preview.
 */
function RecordSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const recordId =
    typeof payload === "object" &&
    payload !== null &&
    "recordId" in payload &&
    typeof payload.recordId === "string"
      ? payload.recordId
      : "";
  const recordQuery = useQuery({
    ...orpc.records.get.queryOptions({ input: { recordId } }),
    enabled: Boolean(recordId),
  });
  const record = recordQuery.data ?? null;
  const relationRecordIds = record
    ? [
        ...new Set(
          record.base.fields
            .filter((field) => field.type === "relation")
            .flatMap((field) => getRelationRecordIds(record.headCommit.payload[field.slug])),
        ),
      ].filter((id) => id !== record.id)
    : [];
  const relationQueries = useQueries({
    queries: relationRecordIds.map((id) =>
      orpc.records.get.queryOptions({ input: { recordId: id } }),
    ),
  });

  if (!record) {
    return recordQuery.isLoading ? (
      <div
        aria-label={messages.common.loading}
        className="flex h-full flex-col gap-4 overflow-hidden p-4"
        data-record-side-panel-loading
        role="status"
      >
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-4/5" />
        <div className="mt-2 space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    ) : (
      <EmptyState
        body={messages.recordView.recordNotFoundBody}
        title={messages.recordView.recordNotFoundTitle}
      />
    );
  }

  const relatedRecords = relationQueries.flatMap((query) => (query.data ? [query.data] : []));
  const previewRecords = [record, ...relatedRecords];

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-auto p-4"
      data-record-side-panel-preview={record.id}
    >
      <header className="border-border/60 border-b pb-3">
        <p className="truncate text-muted-foreground text-xs">{record.base.name}</p>
        <h2 className="mt-1 break-words font-semibold text-base leading-6">
          {getRecordTitle(record, messages)}
        </h2>
      </header>
      <div className="divide-y divide-border/50">
        {record.base.fields.slice(1).map((field) => (
          <section className="min-w-0 py-3" key={field.id}>
            <div className="mb-1.5 truncate font-medium text-muted-foreground text-xs">
              {resolveIString(field.name)}
            </div>
            <div className="min-w-0 break-words text-sm leading-5">
              <FieldValuePreview
                className="max-w-full whitespace-pre-wrap"
                field={field}
                computed={record.computedFields?.[field.slug]}
                fieldUsers={record.fieldUsers}
                records={previewRecords}
                value={record.headCommit.payload[field.slug]}
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
registerSidePanelTab("record-preview", RecordSidePanelPreview);

function findNodeById(nodes: NodeVO[], nodeId: string): NodeVO | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const child = findNodeById(node.children, nodeId);
    if (child) return child;
  }
  return undefined;
}

export function RecordDetailView({
  baseSlug,
  client,
  onDeleteChangeRequest,
  records,
  record,
}: {
  /** The owning Base's route slug (or nodeId/id fallback) — needed to build
   *  the `/base/:slug/:recordId/activity` link for the "•••" menu's Activity
   *  item, mirroring how `NodeActionsMenu` builds its own activity href. */
  baseSlug: string;
  client: BusabaseDashboardApiClient;
  onDeleteChangeRequest: (record: RecordVO, options?: RecordSubmitOptions) => Promise<void>;
  records: RecordVO[];
  record: RecordVO | null;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const currentSearch = useSearch();
  const isAnon = useIsAnonymousVisitor();
  const orpc = useDashboardOrpc();
  const [, setLocation] = useLocation();
  const [panelOpen, setPanelOpen] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [deleteAction, setDeleteAction] = useState<"change_request" | "merge" | null>(null);
  const [confirmDeleteAction, setConfirmDeleteAction] = useState<"change_request" | "merge" | null>(
    null,
  );
  const nodesOptions = orpc?.nodes.list.queryOptions({});
  const nodesQuery = useQuery<NodeVO[]>({
    ...(nodesOptions ?? {
      queryKey: ["record-share", "unavailable", record?.base.nodeId],
      queryFn: async () => [],
    }),
    enabled: Boolean(orpc && shareOpen && record && !isAnon),
  });
  const baseNode = findNodeById(nodesQuery.data ?? [], record?.base.nodeId ?? "");
  const hasPublicLink = Boolean(baseNode?.shared || baseNode?.sharedViaAncestor);

  // Record lineage (the change requests that produced this record), via React
  // Query instead of a useEffect + setState fetch — it caches and refetches on
  // its own and exposes data/error/loading directly.
  const historyQuery = useQuery({
    enabled: Boolean(record) && !isAnon,
    queryFn: () => client.listRecordChangeRequests(record?.id ?? "", { limit: 5 }),
    queryKey: ["busabase", "record-change-requests", record?.id, { limit: 5 }],
  });
  const historyChangeRequests = historyQuery.data ?? [];
  const historyError = historyQuery.error
    ? presentCoreError(messages, locale, historyQuery.error, messages.recordView.failedLoadHistory)
    : null;
  const isHistoryLoading = historyQuery.isLoading;

  if (!record) {
    return (
      <div className="flex-1 p-4">
        <section>
          <EmptyState
            title={messages.recordView.recordNotFoundTitle}
            body={messages.recordView.recordNotFoundBody}
          />
        </section>
      </div>
    );
  }

  const recordUrl =
    typeof window === "undefined"
      ? null
      : dashboardNodeShareUrl({
          currentHref: window.location.href,
          nodeType: "base",
          nodeSlug: record.base.nodeId,
          extraSegments: [record.id],
        });

  const copyRecordUrl = async () => {
    if (!recordUrl) return;
    try {
      await navigator.clipboard.writeText(recordUrl);
      setShareCopied(true);
      toast.success(messages.share.linkCopied);
    } catch {
      setShareCopied(false);
      toast.error(messages.share.failed);
    }
  };

  return (
    <div
      className="h-full min-h-0 w-full min-w-0 flex-1 overflow-auto overflow-x-hidden"
      data-record-detail-scroll
    >
      {!isAnon ? (
        <div className="flex items-center justify-end gap-2 px-6 pt-4">
          <Button onClick={() => setShareOpen(true)} size="sm" type="button" variant="outline">
            <Share2 aria-hidden="true" className="size-4" />
            {messages.share.title}
          </Button>
          <details className="relative">
            <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&::-webkit-details-marker]:hidden">
              <MoreHorizontal size={16} />
            </summary>
            <div className="absolute right-0 z-50 mt-1 w-48 rounded-md border border-border/70 bg-card p-1 shadow-md">
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-medium text-foreground text-sm transition-colors hover:bg-accent"
                onClick={(event) => {
                  setLocation(
                    mergeSearchIntoHref(`/base/${baseSlug}/${record.id}/activity`, currentSearch),
                  );
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
                type="button"
              >
                <History size={13} />
                {messages.nodeDetail.activity}
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-medium text-rejected-strong text-sm transition-colors hover:bg-rejected/17 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={deleteAction !== null}
                onClick={(event) => {
                  setConfirmDeleteAction("change_request");
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
                type="button"
              >
                <Trash2 size={13} />
                {deleteAction === "change_request"
                  ? messages.recordView.creating
                  : messages.recordView.deleteChangeRequest}
              </button>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-medium text-rejected-strong text-sm transition-colors hover:bg-rejected/17 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={deleteAction !== null}
                onClick={(event) => {
                  setConfirmDeleteAction("merge");
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
                type="button"
              >
                <GitMerge size={13} />
                {deleteAction === "merge"
                  ? messages.recordView.merging
                  : messages.recordView.deleteAndMerge}
              </button>
            </div>
          </details>
          <RailToggleButton onToggle={() => setPanelOpen((current) => !current)} open={panelOpen} />
        </div>
      ) : null}
      <Dialog onOpenChange={setShareOpen} open={shareOpen}>
        <DialogContent className="max-w-md" data-testid="record-share-dialog">
          <DialogHeader>
            <DialogTitle>{messages.share.recordLinkTitle}</DialogTitle>
            <DialogDescription>{getRecordTitle(record, messages)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2 rounded-md border border-border/70 p-3 text-sm">
              <p className="font-medium">{messages.share.recordPrivateTitle}</p>
              <p className="text-muted-foreground">{messages.share.recordPrivateHint}</p>
              <p className="text-muted-foreground">{messages.share.recordPublicHint}</p>
            </div>
            {recordUrl && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    aria-label={messages.share.recordLinkTitle}
                    className="min-w-0 flex-1"
                    readOnly
                    value={recordUrl}
                  />
                  <Button onClick={() => void copyRecordUrl()} type="button">
                    {shareCopied ? (
                      <Check aria-hidden="true" className="size-4" />
                    ) : (
                      <Copy aria-hidden="true" className="size-4" />
                    )}
                    {messages.share.copyLink}
                  </Button>
                </div>
                {hasPublicLink && (
                  <ShareLinkActions title={getRecordTitle(record, messages)} url={recordUrl} />
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <section
        className={`grid w-full min-w-0 gap-6 px-6 pt-2 pb-4 ${
          isAnon ? "" : "lg:grid-cols-[minmax(0,1fr)_auto]"
        }`}
      >
        <main
          className={
            isAnon ? "min-w-0 w-full" : "min-w-0 max-w-[860px] justify-self-center lg:w-full"
          }
        >
          <RecordHero record={record} />
          <RecordFieldPanel record={record} records={records} />
          <RecordLinkedFromPanel record={record} />
          {!isAnon ? <RecordCommentsPanel client={client} record={record} /> : null}
        </main>
        {!isAnon ? (
          <BusabaseSidePanel open={panelOpen}>
            <SidebarPanel
              quiet
              title={messages.recordView.lineage}
              action={
                historyChangeRequests[0] ? (
                  <Link
                    className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground"
                    href={mergeSearchIntoHref(
                      `/inbox/${historyChangeRequests[0].id}`,
                      currentSearch,
                    )}
                  >
                    {messages.recordView.view}
                    <ChevronRight aria-hidden="true" size={13} />
                  </Link>
                ) : undefined
              }
            >
              <SidebarRow
                label={messages.recordView.proposedBy}
                value={
                  <UserRefButton
                    fallbackId={record.createdBy}
                    labelClassName="font-medium"
                    title={messages.identity.recordCreator}
                    user={record.createdByUser}
                  />
                }
              />
              <SidebarRow
                label={messages.recordView.commitAuthor}
                value={
                  <UserRefButton
                    fallbackId={record.headCommit.author}
                    labelClassName="font-medium"
                    title={messages.identity.commitAuthor}
                    user={record.headCommit.authorUser}
                  />
                }
              />
              <SidebarRow
                label={messages.common.updated}
                value={formatDetailTime(record.updatedAt, locale)}
              />
              <details
                aria-label={messages.recordView.technicalIds}
                className="mt-3 rounded-md border border-border/70 px-2.5 py-2 text-xs"
              >
                <summary className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground">
                  {messages.recordView.technicalIds}
                </summary>
                <div className="mt-2 space-y-1.5">
                  <SidebarRow label={messages.common.record} value={record.id} />
                  <SidebarRow label={messages.recordView.creatorId} value={record.createdBy} />
                  <SidebarRow
                    label={messages.recordView.authorId}
                    value={record.headCommit.author}
                  />
                  <SidebarRow
                    label={messages.recordView.head}
                    value={shortIdentifier(record.headCommitId)}
                  />
                  <SidebarRow
                    label={messages.recordView.parent}
                    value={shortIdentifier(record.headCommit.parentCommitId)}
                  />
                </div>
              </details>
            </SidebarPanel>
            <SidebarPanel
              quiet
              title={messages.recordView.audit}
              action={
                <Link
                  className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground"
                  href={mergeSearchIntoHref(
                    `/base/${baseSlug}/${record.id}/activity`,
                    currentSearch,
                  )}
                >
                  {messages.recordView.seeAll}
                  <ChevronRight aria-hidden="true" size={13} />
                </Link>
              }
            >
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Box size={16} />
                <span className="truncate">
                  {fmt(messages.recordView.canonicalRecord, { status: record.status })}
                </span>
              </div>
            </SidebarPanel>
            <SidebarPanel
              quiet
              title={messages.recordView.reviewHistory}
              action={
                <Link
                  className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                  href={mergeSearchIntoHref(
                    `/base/${baseSlug}/${record.id}/activity`,
                    currentSearch,
                  )}
                >
                  {messages.recordView.seeAll}
                  <ChevronRight aria-hidden size={12} />
                </Link>
              }
            >
              {historyError ? (
                <div className="rounded-md border border-rejected/35 bg-rejected/17 px-2.5 py-2 text-rejected-strong text-xs">
                  {historyError}
                </div>
              ) : historyChangeRequests.length > 0 ? (
                <div className="-mx-3 divide-y divide-border/40">
                  {historyChangeRequests.map((changeRequest) => (
                    <RecordChangeRequestHistoryRow
                      changeRequest={changeRequest}
                      key={changeRequest.id}
                      recordId={record.id}
                    />
                  ))}
                </div>
              ) : isHistoryLoading ? (
                <div className="space-y-2 py-2" aria-hidden>
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ) : (
                <div className="py-2 text-muted-foreground text-xs">
                  {messages.recordView.noChangeRequestsYet}
                </div>
              )}
            </SidebarPanel>
          </BusabaseSidePanel>
        ) : null}
      </section>
      <ConfirmActionDialog
        body={
          confirmDeleteAction === "merge"
            ? fmt(messages.recordView.deleteMergeBody, { title: getRecordTitle(record, messages) })
            : fmt(messages.recordView.deleteRequestBody, {
                title: getRecordTitle(record, messages),
              })
        }
        confirmLabel={
          confirmDeleteAction === "merge"
            ? messages.recordView.deleteAndMerge
            : messages.base.createDeleteRequestLabel
        }
        onCancel={() => setConfirmDeleteAction(null)}
        onConfirm={async () => {
          if (!confirmDeleteAction) {
            return;
          }
          const nextAction = confirmDeleteAction;
          setDeleteAction(nextAction);
          try {
            await onDeleteChangeRequest(record, {
              mergeImmediately: nextAction === "merge",
            });
            setConfirmDeleteAction(null);
          } finally {
            setDeleteAction(null);
          }
        }}
        open={confirmDeleteAction !== null}
        pending={deleteAction !== null}
        title={
          confirmDeleteAction === "merge"
            ? messages.recordView.deleteMergeTitle
            : messages.recordView.deleteRequestTitle
        }
      />
    </div>
  );
}

export function RecordEditorView({
  base,
  client,
  mode,
  onSubmitCreate,
  onSubmitError,
  onSubmitUpdate,
  onUploadAttachment,
  records,
  record,
}: {
  base: BaseVO | null;
  client: BusabaseDashboardApiClient;
  mode: "new" | "edit";
  onSubmitCreate?: (
    base: BaseVO,
    fields: Record<string, unknown>,
    options?: RecordSubmitOptions,
  ) => Promise<void>;
  onSubmitError: (message: string | null) => void;
  onSubmitUpdate?: (
    record: RecordVO,
    fields: Record<string, unknown>,
    options?: RecordSubmitOptions,
  ) => Promise<void>;
  onUploadAttachment?: (file: File) => Promise<AssetAttachmentRef>;
  records: RecordVO[];
  record: RecordVO | null;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const [fields, setFields] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      (base?.fields ?? record?.base.fields ?? []).map((field) => [
        field.slug,
        mode === "edit" && record
          ? getEditorFieldValue(field, record.headCommit.payload[field.slug])
          : defaultNewFieldValue(field.type),
      ]),
    ),
  );
  const [saveAction, setSaveAction] = useState<"change_request" | "merge" | null>(null);
  const dirty = useRef(false);
  // Preserve the draft's starting revision, even if live queries update the record.
  const draftRecord = useRef(record);
  const changedFields = useRef(new Set<string>());
  const editorBase = base ?? record?.base ?? null;
  const editorIdentity = `${mode}:${editorBase?.id}:${record?.id ?? "new"}`;
  const previousEditorIdentity = useRef(editorIdentity);

  useEffect(() => {
    // Live refreshes must not silently discard a user's in-progress selection.
    if (previousEditorIdentity.current === editorIdentity && dirty.current) return;
    previousEditorIdentity.current = editorIdentity;
    draftRecord.current = record;
    dirty.current = false;
    changedFields.current.clear();
    setFields(
      Object.fromEntries(
        (editorBase?.fields ?? []).map((field) => [
          field.slug,
          mode === "edit" && record
            ? getEditorFieldValue(field, record.headCommit.payload[field.slug])
            : defaultNewFieldValue(field.type),
        ]),
      ),
    );
  }, [editorBase, editorIdentity, mode, record]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmNavigation = (event: MouseEvent) => {
      if (
        !dirty.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.download ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.href === window.location.href || destination.protocol === "javascript:")
        return;
      if (!window.confirm(messages.recordView.discardUnsavedChanges)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", confirmNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", confirmNavigation, true);
    };
  }, [messages.recordView.discardUnsavedChanges]);

  if (!editorBase) {
    return (
      <div className="flex-1 p-4">
        <section>
          <EmptyState
            title={messages.base.baseNotFoundTitle}
            body={messages.base.baseNotFoundBody}
          />
        </section>
      </div>
    );
  }

  if (mode === "edit" && !record) {
    return (
      <div className="flex-1 p-4">
        <section>
          <EmptyState
            title={messages.recordView.recordNotFoundTitle}
            body={messages.recordView.recordNotFoundBody}
          />
        </section>
      </div>
    );
  }

  const submit = async (mergeImmediately = false) => {
    setSaveAction(mergeImmediately ? "merge" : "change_request");
    onSubmitError(null);
    try {
      const normalizedFields = normalizeEditorFields(editorBase, fields);
      const validationErrors = validateRecordFields(normalizedFields, editorBase.fields);
      if (validationErrors.length > 0) {
        const invalidFields = validationErrors
          .map((error) => editorBase.fields.find((field) => field.slug === error.slug))
          .filter((field): field is BaseFieldVO => Boolean(field))
          .map((field) => resolveIString(field.name));
        onSubmitError(fmt(messages.recordView.invalidFields, { fields: invalidFields.join(", ") }));
        return;
      }
      if (mode === "new") {
        await onSubmitCreate?.(editorBase, normalizedFields, { mergeImmediately });
      } else if (record) {
        const patch = Object.fromEntries(
          Object.entries(normalizedFields).filter(([slug]) => changedFields.current.has(slug)),
        );
        await onSubmitUpdate?.(draftRecord.current ?? record, patch, { mergeImmediately });
      }
      dirty.current = false;
      changedFields.current.clear();
    } catch (submitError) {
      onSubmitError(
        submitError instanceof Error
          ? localizeCoreErrorMessage(messages, submitError.message)
          : messages.recordView.failedSaveChangeRequest,
      );
    } finally {
      setSaveAction(null);
    }
  };

  return (
    <div
      className="h-full min-h-0 w-full min-w-0 flex-1 overflow-auto"
      data-dashboard-scroll="record-editor"
    >
      <section className="mx-auto max-w-5xl px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-border/50 border-b pb-3">
          <div className="font-semibold text-base">
            {mode === "new"
              ? fmt(messages.recordView.newRecordTitle, { base: editorBase.name })
              : messages.recordView.editRecord}
          </div>
        </div>

        <div className="mt-5">
          <div className="border-border/50 border-t">
            {editorBase.fields
              // Lookup can preview the current relation selection before save.
              // Other system/AI fields, and read-only reverse relation columns,
              // still have nothing to enter on create.
              .filter(
                (field) =>
                  mode === "edit" ||
                  field.type === "lookup" ||
                  (!isHiddenOnCreate(field.type) && !isReverseRelationDef(field)),
              )
              .map((field) => (
                <RecordFieldInput
                  client={client}
                  editorBase={editorBase}
                  editorInstanceKey={mode === "edit" && record ? record.id : "new"}
                  field={field}
                  computed={record?.computedFields?.[field.slug]}
                  draftRelationIds={
                    field.type === "lookup" &&
                    field.options.lookup &&
                    (mode === "new" ||
                      JSON.stringify(
                        getRelationRecordIds(fields[field.options.lookup.relationFieldSlug]),
                      ) !==
                        JSON.stringify(
                          getRelationRecordIds(
                            record?.headCommit.payload[field.options.lookup.relationFieldSlug],
                          ),
                        ))
                      ? getRelationRecordIds(fields[field.options.lookup.relationFieldSlug])
                      : undefined
                  }
                  key={field.id}
                  memberUsers={record?.fieldUsers}
                  onChange={(value) => {
                    dirty.current = true;
                    changedFields.current.add(field.slug);
                    setFields((current) => ({ ...current, [field.slug]: value }));
                  }}
                  onUploadAttachment={onUploadAttachment}
                  records={records}
                  value={fields[field.slug] ?? ""}
                />
              ))}
          </div>
        </div>

        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 border-border/50 border-t bg-background/95 py-3 backdrop-blur">
          <Link
            className="rounded-md border border-border/70 bg-card px-3 py-1.5 font-medium text-xs transition-colors hover:bg-accent"
            href={
              mode === "edit" && record
                ? `/base/${record.base.slug}/${record.id}`
                : `/base/${editorBase.slug}`
            }
          >
            {messages.common.cancel}
          </Link>
          <SplitSubmitButton
            changeRequestAction={{
              label:
                mode === "new"
                  ? messages.recordView.submitRequest
                  : messages.recordView.updateRequest,
              loadingLabel: messages.recordView.saving,
              onSubmit: () => submit(false),
              isLoading: saveAction === "change_request",
            }}
            disabled={saveAction !== null}
            hint={messages.common.mergeImmediatelyHint}
            immediateAction={{
              label: mode === "new" ? messages.recordView.submitNow : messages.recordView.updateNow,
              loadingLabel: messages.recordView.merging,
              onSubmit: () => submit(true),
              isLoading: saveAction === "merge",
            }}
          />
        </div>
      </section>
    </div>
  );
}

const lookupDraftClients = new WeakMap<BusabaseDashboardApiClient, number>();
let nextLookupDraftClient = 0;
const lookupDraftClientScope = (client: BusabaseDashboardApiClient): number => {
  let scope = lookupDraftClients.get(client);
  if (scope === undefined) {
    scope = ++nextLookupDraftClient;
    lookupDraftClients.set(client, scope);
  }
  return scope;
};

export function RecordFieldInput({
  client,
  editorBase,
  editorInstanceKey,
  field,
  computed,
  draftRelationIds,
  memberUsers,
  onChange,
  onUploadAttachment,
  records,
  value,
}: {
  client: BusabaseDashboardApiClient;
  /** Current editor schema, including the relation a draft Lookup follows. */
  editorBase?: BaseVO;
  /**
   * Identifies which record's editor session this is ("new" for the create
   * form, otherwise the record id) — `RecordEditorView` reuses the same
   * component instance across records of the same base (no route-level
   * remount on navigation), so a stateful editor like `WhiteboardFieldEditor`
   * needs this to force its own canvas to reset when the underlying record
   * changes instead of carrying over the previous record's scene.
   */
  editorInstanceKey: string;
  field: BaseFieldVO;
  computed?: LookupComputedVO;
  draftRelationIds?: string[];
  /** The edited record's already-resolved people, so a set member keeps its name
   *  even when they have since left the space (the roster no longer has them). */
  memberUsers?: Record<string, UserRefVO>;
  onChange: (value: unknown) => void;
  onUploadAttachment?: (file: File) => Promise<AssetAttachmentRef>;
  records: RecordVO[];
  value: unknown;
}) {
  const messages = useCoreI18n();
  const kind = fieldInputKind(field.type);
  const resolveIString = useIString();
  const fieldName = resolveIString(field.name);
  const inputId = `record-field-${field.id}`;
  const helpId = hasFieldHelp(field.options.help) ? `field-help-${field.id}` : undefined;
  const relationValue = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" && value
      ? [value]
      : [];
  const targetRecords =
    field.type === "relation"
      ? records.filter((record) => record.baseId === field.options.targetBaseId)
      : [];
  const choiceValue = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" && value
      ? [value]
      : [];

  const orpc = useDashboardOrpc();
  const draftScope = lookupDraftClientScope(client);
  const config = field.options.lookup;
  const relation = editorBase?.fields.find(
    (candidate) => candidate.type === "relation" && candidate.slug === config?.relationFieldSlug,
  );
  const sourceBaseId = relation?.options.targetBaseId;
  const hasDraft = field.type === "lookup" && draftRelationIds !== undefined;
  // Use the existing scoped query prefixes so SSE, focus and reconnect refresh
  // both authorization and source values. A client identity also isolates hosts
  // without an oRPC context, and credentials changed within the same workspace.
  const sourceQuery = useQuery({
    queryKey: [
      ...(orpc?.bases.get.key() ?? ["busabase", "base-detail"]),
      "lookup-draft-source",
      draftScope,
      sourceBaseId,
    ],
    queryFn: async ({ signal }) => {
      try {
        const source = await client.getBase(sourceBaseId ?? "");
        signal.throwIfAborted();
        return source.id === sourceBaseId ? source : null;
      } catch {
        signal.throwIfAborted();
        // Replace previously authorized schema data on access loss or failure.
        return null;
      }
    },
    enabled: hasDraft && Boolean(config && relation && sourceBaseId),
    gcTime: 0,
    retry: false,
  });
  const source =
    sourceQuery.isFetchedAfterMount && !sourceQuery.isFetching && !sourceQuery.error
      ? sourceQuery.data
      : undefined;
  const dynamicSourceFields = new Set(
    source?.fields
      .filter((candidate) => candidate.type === "lookup")
      .map((candidate) => candidate.slug),
  );
  const sourceGraph = source ? buildFieldGraph(source.fields) : undefined;
  for (const slug of dynamicSourceFields) {
    for (const dependent of sourceGraph?.neighbors(slug) ?? []) dynamicSourceFields.add(dependent);
  }
  const targetField = source?.fields.find(
    (candidate) => candidate.slug === config?.targetFieldSlug,
  );
  const validTarget =
    targetField &&
    !dynamicSourceFields.has(targetField.slug) &&
    isRollupCompatible(config?.rollup ?? "values", targetField.type)
      ? targetField
      : undefined;
  const draftKey = useMemo(
    () => [
      ...(orpc?.records.get.key() ?? ["busabase", "record-detail"]),
      "lookup-draft",
      draftScope,
      editorBase?.id,
      editorInstanceKey,
      field.id,
      config,
      sourceBaseId,
      sourceQuery.dataUpdatedAt,
      draftRelationIds,
    ],
    [
      orpc,
      draftScope,
      editorBase?.id,
      editorInstanceKey,
      field.id,
      config,
      sourceBaseId,
      sourceQuery.dataUpdatedAt,
      draftRelationIds,
    ],
  );
  const draftQuery = useQuery({
    queryKey: draftKey,
    queryFn: async ({ signal }) => {
      if (!source || !validTarget || !config) return null;
      const ids =
        config.limit === "first" ? (draftRelationIds ?? []).slice(0, 1) : (draftRelationIds ?? []);
      try {
        const targets = await Promise.all(ids.map((id) => client.getRecord(id)));
        signal.throwIfAborted();
        if (
          targets.some((target, index) => target.id !== ids[index] || target.baseId !== source.id)
        )
          return null;
        const values = targets.map((target) => target.headCommit.payload[validTarget.slug]);
        return { targets, values, result: applyRollup(values, config.rollup ?? "values") };
      } catch {
        signal.throwIfAborted();
        // Never retain an earlier successful total after a failed revalidation.
        return null;
      }
    },
    enabled:
      hasDraft &&
      Boolean(source && validTarget) &&
      (config?.limit === "first" || (draftRelationIds?.length ?? 0) <= 25),
    gcTime: 0,
    retry: false,
  });
  const draftData =
    source && validTarget && !draftQuery.isFetching && !draftQuery.error
      ? draftQuery.data
      : undefined;
  const draftComputed: LookupComputedVO | undefined =
    draftData && source && validTarget
      ? {
          status:
            draftData.targets.length === 0
              ? "unlinked"
              : emptyLookupValues(draftData.values)
                ? "empty"
                : "ready",
          value: draftData.result,
          targetField: validTarget,
          sourceBaseId: source.id,
          sourceBaseSlug: source.slug,
          sourcesTruncated: false,
          dependencyVersion: `draft:${sourceQuery.dataUpdatedAt}:${draftQuery.dataUpdatedAt}`,
          sources: draftData.targets.map((target, index) => ({
            recordId: target.id,
            title: getRecordTitle(target, messages),
            value: draftData.values[index],
            headCommitId: target.headCommit.id,
          })),
        }
      : undefined;
  const draftUsers = draftData
    ? Object.assign({}, memberUsers, ...draftData.targets.map((target) => target.fieldUsers ?? {}))
    : memberUsers;

  return (
    <div
      role="group"
      aria-describedby={helpId}
      className="grid gap-3 border-border/40 border-b px-2 py-2.5 text-sm transition-colors hover:bg-muted/25 md:grid-cols-[180px_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <label className="block truncate font-medium" htmlFor={inputId}>
          {fieldName}
          {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </label>
        <div className="mt-1 flex flex-wrap gap-1.5 text-muted-foreground text-[11px]">
          {isDerivedFieldSlug(fieldName, field.slug) ? null : (
            <>
              <span className="font-mono">{field.slug}</span>
              <span>·</span>
            </>
          )}
          <span>{messages.fieldTypes[field.type]}</span>
        </div>
        <FieldHelp help={field.options.help} id={helpId} />
      </div>
      {isReverseRelationDef(field) ? (
        <ReverseRelationReadOnlyValue
          client={client}
          field={field}
          inputId={inputId}
          records={targetRecords}
          value={value}
        />
      ) : field.type === "lookup" ? (
        <div
          className="min-h-9 min-w-0 rounded-md border border-border/40 bg-muted/40 px-2.5 py-1.5"
          id={inputId}
        >
          {draftRelationIds !== undefined && !draftComputed ? (
            <div className="text-muted-foreground text-xs">
              <div>{messages.lookup.draft}</div>
              {field.options.lookup?.limit !== "first" && draftRelationIds.length > 25 ? (
                messages.lookup.previewLimit
              ) : !config || !relation || !sourceBaseId || (source && !validTarget) ? (
                messages.lookup.invalid
              ) : sourceQuery.data === null ||
                sourceQuery.error ||
                draftQuery.data === null ||
                draftQuery.error ? (
                <div className="flex items-center gap-2" role="alert">
                  {messages.lookup.failed}
                  <button
                    aria-label={messages.lookup.retry}
                    onClick={() => {
                      void sourceQuery.refetch();
                    }}
                    title={messages.lookup.retry}
                    type="button"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              ) : (
                messages.common.loading
              )}
            </div>
          ) : (
            <LookupFieldValue
              computed={draftComputed ?? computed}
              draft={draftRelationIds !== undefined}
              field={field}
              fieldUsers={draftUsers}
              records={records}
              value={draftComputed?.value ?? value}
            />
          )}
        </div>
      ) : kind === "computed" ? (
        <div
          className="flex min-h-9 items-center rounded-md border border-border/40 bg-muted/40 px-2.5 py-1.5 text-muted-foreground text-sm"
          id={inputId}
        >
          {isPeopleFieldType(field.type) && getMemberIds(value).length > 0 ? (
            // `created_by` / `updated_by` are read-only here, but they still name
            // a PERSON — the grid renders them as a chip, so this box must too
            // rather than printing the raw actor id next to it.
            <MemberChips users={memberUsers} value={value} />
          ) : (
            fieldValueToString(value) || (
              <span className="italic opacity-70">{messages.common.autoGenerated}</span>
            )
          )}
        </div>
      ) : kind === "attachment" ? (
        <AttachmentFieldEditor
          ariaDescribedBy={helpId}
          field={field}
          inputId={inputId}
          onChange={onChange}
          onUploadAttachment={onUploadAttachment}
          value={value}
        />
      ) : kind === "relation" ? (
        <RelationFieldEditor
          ariaDescribedBy={helpId}
          client={client}
          field={field}
          fieldName={fieldName}
          inputId={inputId}
          loadedRecords={targetRecords}
          onChange={onChange}
          value={relationValue}
        />
      ) : kind === "member" ? (
        <MemberFieldEditor
          ariaDescribedBy={helpId}
          client={client}
          field={field}
          fieldName={fieldName}
          inputId={inputId}
          onChange={onChange}
          users={memberUsers}
          value={value}
        />
      ) : kind === "select" ? (
        <select
          aria-describedby={helpId}
          aria-label={fieldName}
          className="h-9 w-full rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          value={fieldValueToString(value)}
        >
          <option value="">-</option>
          {(field.options.choices ?? []).map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
      ) : kind === "multiselect" ? (
        <select
          aria-describedby={helpId}
          aria-label={fieldName}
          className="min-h-9 w-full rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
          id={inputId}
          multiple
          onChange={(event) =>
            onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
          }
          value={choiceValue}
        >
          {(field.options.choices ?? []).map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
      ) : kind === "tags" ? (
        <TagFieldEditor
          ariaDescribedBy={helpId}
          inputId={inputId}
          label={fieldName}
          onChange={onChange}
          value={value}
        />
      ) : kind === "checkbox" ? (
        <label className="inline-flex h-9 items-center gap-2 text-muted-foreground text-sm">
          <input
            aria-describedby={helpId}
            checked={value === true}
            id={inputId}
            onChange={(event) => onChange(event.target.checked)}
            type="checkbox"
          />
          {messages.recordView.checked}
        </label>
      ) : kind === "textarea" ? (
        <RichTextareaFieldEditor
          ariaDescribedBy={helpId}
          field={field}
          inputId={inputId}
          label={fieldName}
          onChange={onChange}
          value={value}
        />
      ) : kind === "whiteboard" ? (
        <WhiteboardFieldEditor
          editorInstanceKey={editorInstanceKey}
          onChange={onChange}
          value={value}
        />
      ) : kind === "date" ? (
        <DateFieldInput
          ariaDescribedBy={helpId}
          ariaLabel={fieldName}
          className="h-9 w-full rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
          id={inputId}
          onChange={onChange}
          options={getDateFieldOptions(field.options)}
          value={value}
        />
      ) : (
        // Plain inputs — the registry's input kind doubles as the HTML input type
        // (text / number / date / url / email / tel).
        <input
          aria-describedby={helpId}
          aria-label={fieldName}
          className="h-9 w-full rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
          id={inputId}
          type={kind}
          onChange={(event) => onChange(event.target.value)}
          value={fieldValueToString(value)}
        />
      )}
    </div>
  );
}

function RichTextareaFieldEditor({
  ariaDescribedBy,
  field,
  inputId,
  label,
  onChange,
  value,
}: {
  ariaDescribedBy?: string;
  field: BaseFieldVO;
  inputId: string;
  label: string;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const text = fieldValueToString(value);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const canPreview = field.type === "markdown" || field.type === "html";
  const isCodeLike = field.type === "code" || field.type === "json" || field.type === "yaml";

  const textarea = (className = "min-h-28", withId = true) => (
    <textarea
      aria-describedby={withId ? ariaDescribedBy : `${inputId}-fullscreen-help`}
      aria-label={label}
      className={`${className} w-full resize-y rounded-md border border-border/70 bg-card px-2.5 py-2 font-mono text-sm leading-6 outline-none transition-colors focus:border-primary`}
      id={withId ? inputId : undefined}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={!isCodeLike}
      value={text}
    />
  );

  const preview = () => {
    if (field.type === "markdown") {
      return (
        <div className="min-h-28 rounded-md border border-border/70 bg-card px-2.5 py-2">
          <MarkdownFieldPreview value={text} />
        </div>
      );
    }
    if (field.type === "html") {
      return (
        <div className="min-h-28 rounded-md border border-border/70 bg-card px-2.5 py-2">
          <HtmlFieldPreview value={text} />
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-w-0">
      {canPreview || isCodeLike ? (
        <div className="mb-1.5 flex items-center justify-end gap-1.5">
          {canPreview ? (
            <button
              aria-pressed={previewOpen}
              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors ${
                previewOpen
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/70 bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              onClick={() => setPreviewOpen((current) => !current)}
              type="button"
            >
              <Eye size={13} />
              {messages.recordView.preview}
            </button>
          ) : null}
          <button
            aria-label={messages.recordView.expandFullscreen}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setFullscreenOpen(true)}
            title={messages.recordView.expandFullscreen}
            type="button"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      ) : null}

      {previewOpen && canPreview ? preview() : textarea()}

      <Dialog onOpenChange={setFullscreenOpen} open={fullscreenOpen}>
        <DialogContent className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[1040px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-5 py-3 text-left">
            <DialogTitle className="text-sm font-medium">{label}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            <FieldHelp help={field.options.help} id={`${inputId}-fullscreen-help`} />
            {previewOpen && canPreview ? preview() : textarea("min-h-[58vh]", false)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ExcalidrawModule = typeof import("@excalidraw/excalidraw");

// Only the scene-relevant subset of AppState is persisted (mirrors the
// Whiteboard NODE type's own `persistentAppState` in
// rich-node/components/whiteboard-detail-view.tsx) — the rest (selection,
// zoom, collaborators, …) is ephemeral editor UI state, not part of the
// record's stored value.
const whiteboardPersistentAppState = (appState: AppState): Record<string, unknown> => ({
  gridSize: appState.gridSize,
  gridStep: appState.gridStep,
  theme: appState.theme,
  viewBackgroundColor: appState.viewBackgroundColor,
});

// How long to wait after the user stops drawing before re-exporting the SVG
// snapshot — exporting on every keystroke/drag would be wasteful (the SVG
// export walks every element). This only debounces the *thumbnail* export;
// the scene itself is pushed to the parent's field state on every change (see
// below) so clicking Submit right after a stroke never loses that stroke.
// Persistence itself still only ever reaches the server on the record-level
// Submit button, exactly like every other field type.
const WHITEBOARD_EXPORT_DEBOUNCE_MS = 500;

/**
 * Fully-editable Excalidraw canvas for the `whiteboard` field type's record
 * edit form. Local component state only — no autosave: every change updates
 * this field's value in the parent `RecordEditorView`'s `fields` state (via
 * `onChange`), and that value is only ever persisted when the user clicks the
 * record-level Submit button, same as every other field editor in this file.
 *
 * Read-only surfaces (table cell, Record Detail view mode) never mount this
 * component — they render `WhiteboardFieldPreview`'s static `previewSvg`
 * instead (see field-preview.tsx).
 */
function WhiteboardFieldEditor({
  editorInstanceKey,
  onChange,
  value,
}: {
  editorInstanceKey: string;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const [initialValue] = useState(() => parseWhiteboardFieldValue(value));
  // Stable reference, computed once — `initialData` is meant to seed the
  // canvas at mount only; an inline object literal would get a fresh identity
  // on every re-render for no reason. (The actual infinite-loop fix is the
  // `lastReportedSceneKeyRef` dedup check below — see its comment.)
  const [initialData] = useState(() => ({
    elements: initialValue.scene.elements as ExcalidrawInitialDataState["elements"],
    appState: initialValue.scene.appState as ExcalidrawInitialDataState["appState"],
    scrollToContent: true,
  }));
  const [excalidrawModule, setExcalidrawModule] = useState<ExcalidrawModule | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the latest scene/thumbnail across the debounce window so the
  // delayed SVG export (below) never clobbers a scene change that happened
  // after it was scheduled.
  const latestSceneRef = useRef<WhiteboardDocument>(initialValue.scene);
  const latestPreviewSvgRef = useRef<string>(initialValue.previewSvg);
  // Excalidraw calls `onChange` from its own `componentDidUpdate` on EVERY
  // update of its internal component — not only on genuine user edits, but
  // also whenever its parent (this component) re-renders and Excalidraw's
  // non-memoized child re-renders along with it. Without a real-change check,
  // that's an unconditional loop: onChange fires -> we call the parent's
  // onChange -> parent setState -> this component re-renders -> Excalidraw
  // re-renders -> componentDidUpdate fires onChange again -> repeat forever
  // (confirmed via instrumentation: `t.componentDidUpdate` in Excalidraw's own
  // bundle appears directly in the call stack; this is not about prop
  // identity — reproduced React error #185 even with both `initialData` and
  // `onChange` fully stabilized). Comparing the serialized scene against the
  // last one we actually reported breaks the cycle: a no-op update reports an
  // identical scene, so we skip touching parent state and the cascade stops.
  const lastReportedSceneKeyRef = useRef(JSON.stringify(initialValue.scene));
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const excalidrawModuleRef = useRef(excalidrawModule);
  excalidrawModuleRef.current = excalidrawModule;

  const handleExcalidrawChange = useCallback((elements: unknown, appState: AppState) => {
    const persistableElements = (elements as NonDeletedExcalidrawElement[]).filter(
      (element) => element.type !== "image",
    );
    const nextScene: WhiteboardDocument = {
      version: 1,
      elements: persistableElements,
      appState: whiteboardPersistentAppState(appState),
    };
    const nextSceneKey = JSON.stringify(nextScene);
    if (nextSceneKey === lastReportedSceneKeyRef.current) {
      return;
    }
    lastReportedSceneKeyRef.current = nextSceneKey;
    latestSceneRef.current = nextScene;
    // Push the scene up immediately — this is what Submit actually reads, so
    // it must never be stale even if the user submits within the debounce
    // window below. The SVG thumbnail is purely cosmetic and can lag by one
    // export cycle.
    onChangeRef.current({ scene: nextScene, previewSvg: latestPreviewSvgRef.current });

    if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    exportTimerRef.current = setTimeout(() => {
      void (async () => {
        let previewSvg = "";
        try {
          const svg = await excalidrawModuleRef.current?.exportToSvg({
            elements: persistableElements as unknown as readonly NonDeletedExcalidrawElement[],
            appState,
            files: null,
          });
          if (svg) previewSvg = new XMLSerializer().serializeToString(svg);
        } catch {
          previewSvg = "";
        }
        latestPreviewSvgRef.current = previewSvg;
        // Use the latest scene at flush time (not the one captured by this
        // closure) in case more edits landed during the debounce window —
        // otherwise this would resurrect a stale, older scene over whatever
        // the user drew since.
        onChangeRef.current({ scene: latestSceneRef.current, previewSvg });
      })();
    }, WHITEBOARD_EXPORT_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([import("@excalidraw/excalidraw"), import("@excalidraw/excalidraw/index.css")])
      .then(([module]) => {
        if (active) setExcalidrawModule(module);
      })
      .catch((caught: unknown) => {
        if (active) {
          setEditorError(
            presentCoreError(messages, locale, caught, messages.inbox.loadFailedTitle),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [locale, messages]);

  useEffect(
    () => () => {
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    },
    [],
  );

  const Editor = excalidrawModule?.Excalidraw;

  return (
    <div className="min-w-0">
      <div className="h-[420px] w-full overflow-hidden rounded-md border border-border/70 bg-muted/20">
        {editorError ? (
          <div className="flex h-full items-center justify-center text-rejected-strong text-sm">
            {editorError}
          </div>
        ) : Editor ? (
          <Editor
            UIOptions={{
              canvasActions: { loadScene: false, saveToActiveFile: false },
              tools: { image: false },
            }}
            handleKeyboardGlobally={false}
            initialData={initialData}
            key={editorInstanceKey}
            langCode={locale}
            onChange={handleExcalidrawChange}
          />
        ) : (
          <WhiteboardContentSkeleton />
        )}
      </div>
    </div>
  );
}

// Editable tag input (ai_tags): chips with remove buttons + a free-text entry.
// Enter / comma commits a tag; Backspace/Delete on an empty field removes the last.
function TagFieldEditor({
  ariaDescribedBy,
  inputId,
  label,
  onChange,
  value,
}: {
  ariaDescribedBy?: string;
  inputId: string;
  label: string;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const tags = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  const [draft, setDraft] = useState("");

  const addTag = (raw: string) => {
    const tag = raw.trim();
    setDraft("");
    if (!tag || tags.includes(tag)) {
      return;
    }
    onChange([...tags, tag]);
  };
  const removeTag = (tag: string) => onChange(tags.filter((item) => item !== tag));

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border/70 bg-card px-2 py-1.5 transition-colors focus-within:border-primary">
      {tags.map((tag) => (
        <span
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/60 px-2 py-0.5 text-xs"
          key={tag}
        >
          <span className="max-w-[14rem] truncate sm:max-w-[20rem]" title={tag}>
            {tag}
          </span>
          <button
            aria-label={fmt(messages.recordView.remove, { name: tag })}
            className="text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => removeTag(tag)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" || event.key === "Delete") {
                event.preventDefault();
                removeTag(tag);
              }
            }}
            title={fmt(messages.recordView.remove, { name: tag })}
            type="button"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        aria-describedby={ariaDescribedBy}
        className="min-w-[6rem] flex-1 bg-transparent text-sm outline-none"
        id={inputId}
        onBlur={() => addTag(draft)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            addTag(draft);
          } else if (
            (event.key === "Backspace" || event.key === "Delete") &&
            draft === "" &&
            tags.length > 0
          ) {
            event.preventDefault();
            removeTag(tags[tags.length - 1]);
          }
        }}
        placeholder={tags.length === 0 ? messages.recordView.addTag : ""}
        value={draft}
      />
    </div>
  );
}

function AttachmentFieldEditor({
  ariaDescribedBy,
  field,
  inputId,
  onChange,
  onUploadAttachment,
  value,
}: {
  ariaDescribedBy?: string;
  field: BaseFieldVO;
  inputId: string;
  onChange: (value: unknown) => void;
  onUploadAttachment?: (file: File) => Promise<AssetAttachmentRef>;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const fieldName = resolveIString(field.name);
  const locale = useCoreLocale();
  const attachments = getAttachmentRefs(value);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const options = field.options.attachment ?? {};
  const multiple = options.maxFiles !== 1;
  const accept = options.allowedMimeTypes?.join(",");

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !onUploadAttachment) {
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    try {
      const uploaded: AssetAttachmentRef[] = [];
      for (const file of Array.from(fileList)) {
        uploaded.push(await onUploadAttachment(file));
      }
      const next = multiple ? [...attachments, ...uploaded] : uploaded.slice(-1);
      onChange(options.maxFiles && options.maxFiles > 0 ? next.slice(-options.maxFiles) : next);
    } catch (error) {
      setUploadError(presentCoreError(messages, locale, error, messages.recordView.uploadFailed));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="grid gap-2">
      <label
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-border/70 border-dashed bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
        htmlFor={inputId}
      >
        <Paperclip size={14} />
        {isUploading ? messages.recordView.uploading : messages.recordView.addFile}
      </label>
      <input
        accept={accept}
        aria-describedby={ariaDescribedBy}
        aria-label={fieldName}
        className="sr-only"
        disabled={isUploading || !onUploadAttachment}
        id={inputId}
        multiple={multiple}
        onChange={(event) => {
          void handleFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
        type="file"
      />
      {uploadError ? <p className="text-destructive text-xs">{uploadError}</p> : null}
      {attachments.length > 0 ? (
        <ul className="grid gap-1">
          {attachments.map((item) => {
            const safeUrl = getSafeAttachmentUrl(item);
            return (
              <li
                className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-sm"
                key={item.id}
              >
                <Paperclip className="shrink-0 text-muted-foreground" size={13} />
                {safeUrl ? (
                  <a
                    className="min-w-0 flex-1 truncate text-primary underline-offset-2 hover:underline"
                    href={safeUrl}
                    rel="noreferrer"
                    target="_blank"
                    title={item.fileName}
                  >
                    {item.fileName}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-foreground" title={item.fileName}>
                    {item.fileName}
                  </span>
                )}
                {formatAttachmentSize(item.size) ? (
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {formatAttachmentSize(item.size)}
                  </span>
                ) : null}
                <button
                  aria-label={fmt(messages.recordView.remove, { name: item.fileName })}
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onChange(attachments.filter((entry) => entry.id !== item.id))}
                  type="button"
                >
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Coerce ONE editor value into the shape the server stores for that field type.
 *
 * Exported per-field (rather than only as the whole-record `normalizeEditorFields`
 * below) because a bulk edit patches a SUBSET of fields: running the whole-record
 * version there would fill every untouched field with its default and overwrite
 * data the user never looked at.
 */
export const normalizeEditorFieldValue = (field: BaseFieldVO, value: unknown): unknown => {
  if (field.type === "attachment") {
    return getAttachmentRefs(value);
  }
  if (field.type === "number") {
    // An empty input clears the field; it is distinct from an explicit zero.
    if (value == null || (typeof value === "string" && value.trim() === "")) return null;
    // Keep invalid input intact so field validation can report it instead of
    // silently clearing it or coercing booleans/arrays into a numeric value.
    if (typeof value !== "string" && typeof value !== "number") return value;
    const numberValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : value;
  }
  if (field.type === "checkbox") {
    return value === true || value === "true";
  }
  if (field.type === "multiselect" || field.type === "relation" || field.type === "ai_tags") {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : typeof value === "string" && value
        ? [value]
        : [];
  }
  if (field.type === "whiteboard") {
    // Re-validate/reshape defensively at submit time, same spirit as the
    // other structured types above — guarantees the server always
    // receives a well-formed { scene, previewSvg } value.
    return parseWhiteboardFieldValue(value);
  }
  return value ?? "";
};

/**
 * A reverse relation column in the record editor: the linking records as chips,
 * never an editor. The relationship is stored on the forward field of the
 * linked Base, so the hint names that Base.
 */
function ReverseRelationReadOnlyValue({
  client,
  field,
  inputId,
  records,
  value,
}: {
  client: BusabaseDashboardApiClient;
  field: BaseFieldVO;
  inputId: string;
  records: RecordVO[];
  value: unknown;
}) {
  const messages = useCoreI18n();
  const targetBaseId = field.options.targetBaseId;
  const targetBaseQuery = useQuery({
    enabled: Boolean(targetBaseId),
    queryFn: () => client.getBase(targetBaseId as string),
    queryKey: ["busabase", "reverse-relation-base", targetBaseId],
    staleTime: 60_000,
  });
  const baseName = targetBaseQuery.data?.name;
  return (
    <div
      className="min-h-9 min-w-0 rounded-md border border-border/40 bg-muted/40 px-2.5 py-1.5"
      data-reverse-relation-field={field.slug}
      id={inputId}
    >
      <FieldValuePreview field={field} records={records} value={value} />
      <p className="mt-1 text-muted-foreground text-xs">
        {messages.reverseRelation.readOnly} ·{" "}
        {baseName
          ? fmt(messages.reverseRelation.editIn, { base: baseName })
          : messages.reverseRelation.editOnLinked}
      </p>
    </div>
  );
}

/** At most this many linking records are fetched for the "Linked from" panel. */
const LINKED_FROM_LIMIT = 50;

/**
 * "Linked from": records on other Bases (or this one) whose relation fields
 * point at this record — the backlinks no relation column on this Base shows.
 * Links already surfaced by a reverse column here are left out so the same
 * records are not listed twice. Hidden when nothing links here.
 */
function RecordLinkedFromPanel({ record }: { record: RecordVO }) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const currentSearch = useSearch();
  // Hosts and tests may mount the record page with a partial client; the panel
  // is an extra, so it simply stays hidden when `records` is not available.
  const recordsApi = useDashboardOrpc()?.records;
  const linksQuery = useQuery({
    ...(recordsApi?.listLinks.queryOptions({
      input: { recordId: record.id, direction: "inbound" },
    }) ?? {
      queryKey: ["busabase", "record-linked-from", "unavailable", record.id],
      queryFn: async () => [],
    }),
    enabled: Boolean(recordsApi),
  });
  const shownByReverseColumns = new Set(
    record.base.fields.flatMap((field) =>
      isReverseRelationDef(field) && field.options.reverseOfFieldId
        ? [field.options.reverseOfFieldId]
        : [],
    ),
  );
  const links = (linksQuery.data ?? []).filter(
    (link) => !shownByReverseColumns.has(link.fieldId) && link.sourceRecordId !== record.id,
  );
  const sourceIds = [...new Set(links.map((link) => link.sourceRecordId))].slice(
    0,
    LINKED_FROM_LIMIT,
  );
  const sourceQueries = useQueries({
    queries: recordsApi
      ? sourceIds.map((id) => recordsApi.get.queryOptions({ input: { recordId: id } }))
      : [],
  });
  if (!recordsApi || links.length === 0) {
    return linksQuery.isError ? (
      <p className="mt-5 text-muted-foreground text-xs" role="alert">
        {messages.reverseRelation.loadFailed}
      </p>
    ) : null;
  }
  const sourcesById = new Map(
    sourceQueries.flatMap((query) => (query.data ? [[query.data.id, query.data] as const] : [])),
  );
  const groups = new Map<string, { label: string; records: RecordVO[] }>();
  for (const link of links) {
    const source = sourcesById.get(link.sourceRecordId);
    if (!source) continue;
    const sourceField = source.base.fields.find((field) => field.id === link.fieldId);
    const key = `${link.baseId}|${link.fieldId}`;
    const group = groups.get(key) ?? {
      label: fmt(messages.reverseRelation.linkedFromGroup, {
        base: source.base.name,
        field: sourceField ? resolveIString(sourceField.name) : link.fieldSlug,
      }),
      records: [],
    };
    if (!group.records.some((item) => item.id === source.id)) group.records.push(source);
    groups.set(key, group);
  }
  if (groups.size === 0) return null;
  return (
    <section className="mt-6" data-record-linked-from={record.id}>
      <div className="font-medium text-muted-foreground text-sm">
        {messages.reverseRelation.linkedFrom}
      </div>
      <div className="mt-2 grid gap-3">
        {[...groups].map(([key, group]) => (
          <div className="text-sm" data-linked-from-group={key} key={key}>
            <div className="text-muted-foreground text-xs">{group.label}</div>
            <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
              {group.records.map((source) => {
                const label = getRecordTitle(source, messages);
                return (
                  <Link
                    className="max-w-64 truncate rounded-md border bg-card px-2 py-0.5 text-primary text-xs transition-colors hover:border-primary/40 hover:bg-primary/5 hover:underline"
                    href={mergeSearchIntoHref(
                      `/base/${source.base.slug}/${source.id}`,
                      currentSearch,
                    )}
                    key={source.id}
                    title={label}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const normalizeEditorFields = (base: BaseVO, fields: Record<string, unknown>) =>
  Object.fromEntries(
    base.fields
      // System fields and reverse relation columns are computed server-side;
      // never send them from the editor.
      .filter((field) => !isReadOnlyFieldDef(field))
      .map((field) => [field.slug, normalizeEditorFieldValue(field, fields[field.slug])]),
  );

function RecordFieldPanel({ record, records }: { record: RecordVO; records: RecordVO[] }) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const fieldEntries = record.base.fields.slice(1).map((field) => ({
    field,
    value: record.headCommit.payload[field.slug],
  }));

  return (
    <section className="mt-5">
      {fieldEntries.length > 0 ? (
        <div className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
          <div className="font-medium text-muted-foreground md:col-span-2">
            {messages.recordView.properties}
          </div>
          {fieldEntries.map(({ field, value }) =>
            isRecordLongField(field) ? (
              <section
                className="group/prop mt-5 max-w-3xl md:col-span-2"
                data-record-field-slug={field.slug}
                key={field.id}
              >
                <div className="flex items-center gap-1 font-medium text-muted-foreground text-sm">
                  <span className="truncate">{resolveIString(field.name)}</span>
                  <CellAgentPromptsButton field={field} record={record} />
                </div>
                <div className="mt-3 text-base leading-7">
                  <FieldValuePreview
                    className={
                      field.type === "html" ||
                      field.type === "code" ||
                      field.type === "json" ||
                      field.type === "yaml" ||
                      field.type === "whiteboard"
                        ? "text-sm"
                        : "whitespace-pre-wrap text-foreground/95"
                    }
                    field={field}
                    computed={record.computedFields?.[field.slug]}
                    fieldUsers={record.fieldUsers}
                    record={record}
                    records={records}
                    value={value}
                  />
                </div>
              </section>
            ) : (
              <RecordPropertyItem
                field={field}
                key={field.id}
                record={record}
                records={records}
                value={value}
              />
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * "Ask my agent about THIS value" — one per property row on the record page.
 *
 * The narrowest of the three Agent-prompt entry points, and the one the others
 * cannot express: the column menu means "this field on every record", the
 * topbar button means "every field of this record", and neither says "this
 * cell". Pointing at a single value on screen is exactly how people describe
 * the change they want, so the entry point lives where the value is.
 *
 * Hidden until the row is hovered or the button is focused: a Base can carry
 * dozens of properties, and a permanently visible icon on each turns the panel
 * into a wall of sparkles. `focus-visible` keeps it keyboard-reachable — the
 * button is always in the tab order, only its paint is conditional.
 */
function CellAgentPromptsButton({ field, record }: { field: BaseFieldVO; record: RecordVO }) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const [open, setOpen] = useState(false);
  const isAnon = useIsAnonymousVisitor();
  if (isAnon) {
    return null;
  }

  const fieldName = resolveIString(field.name);
  return (
    <>
      <button
        aria-label={`${messages.agentPrompts.title} · ${fieldName}`}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/prop:opacity-100"
        data-testid={`cell-agent-prompts-${field.slug}`}
        onClick={() => setOpen(true)}
        title={messages.agentPrompts.title}
        type="button"
      >
        <Sparkles className="size-3" />
      </button>
      {open && (
        // `orpc={null}` — same reasoning as `RecordTopbarActions` above: a
        // cell-scoped dialog never reads custom scenario prompts (§7.3 only
        // replaces the whole-node scenario tier), so it must not fetch them.
        <NodeAgentPromptsDialog
          orpc={null}
          nodeId={record.base.nodeId}
          nodeName={record.base.name}
          nodeType="base"
          onOpenChange={setOpen}
          open={open}
          scope={{
            fieldName,
            fieldSlug: field.slug,
            fieldType: field.type,
            kind: "cell",
            recordId: record.id,
            recordTitle: getRecordTitle(record, messages),
          }}
        />
      )}
    </>
  );
}

function RecordPropertyItem({
  field,
  record,
  records,
  value,
}: {
  field: BaseFieldVO;
  record: RecordVO;
  records: RecordVO[];
  value: unknown;
}) {
  const resolveIString = useIString();
  const fieldName = resolveIString(field.name);
  if (fieldDisplayKind(field.type) === "checkbox") {
    const checked = value === true || value === "true";
    return (
      <div
        className="group/prop grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-center gap-3"
        data-record-field-slug={field.slug}
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-muted-foreground">{fieldName}</span>
          <CellAgentPromptsButton field={field} record={record} />
        </span>
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
            checked
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border/70 bg-muted/30 text-muted-foreground"
          }`}
        >
          {checked ? <Check size={12} /> : null}
        </span>
      </div>
    );
  }

  const chips = getFieldChipEntries(field, value);
  if (chips.length > 0) {
    return (
      <div
        className="group/prop grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-start gap-3"
        data-record-field-slug={field.slug}
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-muted-foreground">{fieldName}</span>
          <CellAgentPromptsButton field={field} record={record} />
        </span>
        <FieldBadgeList chips={chips} />
      </div>
    );
  }

  return (
    <div
      className="group/prop grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-start gap-3"
      data-record-field-slug={field.slug}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-muted-foreground">{fieldName}</span>
        <CellAgentPromptsButton field={field} record={record} />
      </span>
      <div className="min-w-0 truncate">
        <FieldValuePreview
          className="inline text-sm leading-5"
          field={field}
          computed={record.computedFields?.[field.slug]}
          fieldUsers={record.fieldUsers}
          record={record}
          records={records}
          value={value}
        />
      </div>
    </div>
  );
}

function RecordHero({ record }: { record: RecordVO }) {
  const messages = useCoreI18n();

  return (
    <div className="mt-2">
      <h1 className="max-w-4xl font-semibold text-4xl leading-tight tracking-tight">
        {getRecordTitle(record, messages)}
      </h1>
    </div>
  );
}

function RecordChangeRequestHistoryRow({
  changeRequest,
  recordId,
}: {
  changeRequest: ChangeRequestVO;
  recordId: string;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const href = useHrefWithCurrentSearch(`/inbox/${changeRequest.id}`);
  const relatedOperations = changeRequest.operations.filter(
    (operation) =>
      operation.mergedRecordId === recordId ||
      operation.targetRecordId === recordId ||
      operation.sourceRecordId === recordId,
  );

  return (
    <Link
      className="block rounded-md border-border/40 border-b px-2 py-2.5 transition-colors hover:bg-muted/35"
      href={href}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-sm">
            {getChangeRequestTitle(changeRequest, messages)}
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {formatUserRefLabel(changeRequest.submittedByUser, changeRequest.submittedBy, messages)}
            {" · "}
            {formatFullTime(changeRequest.updatedAt, locale)}
          </div>
        </div>
        <StatusBadge status={changeRequest.status} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {relatedOperations.map((operation) => (
          <span
            className={`rounded-md px-2 py-0.5 text-xs ${operationMeta[operation.operation].tone}`}
            key={operation.id}
          >
            {getOperationLabel(operation, messages)} · {shortIdentifier(operation.headCommitId)}
          </span>
        ))}
      </div>
    </Link>
  );
}

function RecordCommentsPanel({
  client,
  record,
}: {
  client: BusabaseDashboardApiClient;
  record: RecordVO;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  // Shares the canonical comments key (subjectType, subjectId) with
  // `SubjectCommentThread`, so the two readers stay in sync.
  const queryKey = ["busabase", "comments", "record", record.id];
  const commentsQuery = useQuery({
    queryFn: () => client.listComments({ subjectId: record.id, subjectType: "record" }),
    queryKey,
  });
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: (text: string) =>
      client.createComment({
        // No mention picker on this surface yet (record comments are the next
        // phase) — but the duplicated `@ai` regex is gone regardless: it wrote a
        // boolean the server no longer has, and guessing a target from prose is
        // exactly what structured mentions exist to stop.
        authorId: "local-admin",
        body: text,
        subjectId: record.id,
        subjectType: "record",
      }),
    onError: (mutationError) =>
      setError(presentCoreError(messages, locale, mutationError, messages.comments.failed)),
    onSuccess: () => {
      setBody("");
      setError(null);
      queryClient.invalidateQueries({ queryKey });
    },
  });
  const comments = commentsQuery.data ?? [];
  const isLoading = commentsQuery.isLoading;

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) {
      return;
    }
    createMutation.mutate(trimmed);
  };

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-sm">{messages.comments.comments}</div>
        {isLoading ? (
          <Skeleton className="h-6 w-9" aria-hidden />
        ) : (
          <span className="rounded-md bg-muted/55 px-2.5 py-1 text-muted-foreground text-xs">
            {comments.length}
          </span>
        )}
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-sm">
          {error}
        </div>
      ) : null}

      <div className="mt-3 border-border/50 border-t">
        {comments.length > 0 ? (
          comments.map((comment) => (
            <div
              className="rounded-md border-border/40 border-b px-2 py-2.5 transition-colors hover:bg-muted/25"
              key={comment.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <UserRefButton
                  fallbackId={comment.authorId}
                  labelClassName="font-medium text-sm"
                  title={messages.identity.commentAuthor}
                  user={comment.author}
                />
                <div className="text-muted-foreground text-xs">
                  {formatFullTime(comment.createdAt, locale)}
                </div>
              </div>
              <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                {/* Read-only chips: this surface cannot yet CREATE a mention,
                    but one made from mobile or the API must still render as a
                    mention here rather than as raw text. */}
                {renderMentionedText(comment.body, 0, comment.mentions)}
              </div>
            </div>
          ))
        ) : isLoading ? (
          <div className="space-y-3 px-2 py-5" aria-hidden>
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <div className="px-2 py-5 text-muted-foreground text-sm">
            {messages.comments.noComments}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-md border border-border/70 bg-background/55 p-3">
        <textarea
          aria-label={messages.comments.addComment}
          className="min-h-20 w-full resize-y rounded-md border border-border/70 bg-card px-2.5 py-2 text-sm leading-6 outline-none transition-colors focus:border-primary"
          onChange={(event) => setBody(event.target.value)}
          placeholder={messages.comments.addComment}
          value={body}
        />
        <div className="mt-2 flex justify-end">
          <button
            className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background text-xs transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={createMutation.isPending || body.trim().length === 0}
            onClick={submit}
            type="button"
          >
            {createMutation.isPending ? messages.comments.adding : messages.comments.addComment}
          </button>
        </div>
      </div>
    </section>
  );
}
