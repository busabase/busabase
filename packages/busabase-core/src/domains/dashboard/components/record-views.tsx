import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { WhiteboardDocument } from "busabase-contract/domains/rich-node/types";
import type {
  AssetAttachmentRef,
  BaseFieldVO,
  BaseVO,
  ChangeRequestVO,
  FieldType,
  RecordVO,
} from "busabase-contract/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "kui/dialog";
import {
  Box,
  Check,
  ChevronRight,
  Eye,
  GitMerge,
  History,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n, useCoreLocale, useIString } from "../../../i18n";
import { localizeCoreErrorMessage } from "../../../i18n/localize-error";
import { validateRecordFields } from "../../base/field-rules";
import {
  fieldDisplayKind,
  fieldInputKind,
  isHiddenOnCreate,
  isSystemFieldType,
} from "../../base/field-types";
import { getPrimaryField } from "../../base/utils/primary-field";
import {
  EMPTY_WHITEBOARD_FIELD_VALUE,
  parseWhiteboardFieldValue,
} from "../../base/utils/whiteboard-value";
import {
  getChangeRequestTitle,
  getOperationLabel,
  getRecordTitle,
  isDerivedFieldSlug,
  operationMeta,
} from "../helpers/change-request";
import {
  getAttachmentRefs,
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
import type { RecordSubmitOptions } from "../helpers/view-types";
import { useIsAnonymousVisitor } from "../visitor-context";
import { renderMentionedText } from "./comments";
import {
  FieldBadgeList,
  FieldValuePreview,
  HtmlFieldPreview,
  MarkdownFieldPreview,
} from "./field-preview";
import { UserRefButton } from "./identity";
import { NodeAgentPromptsButton } from "./node-agent-prompts-button";
import { NodeAgentPromptsDialog } from "./node-agent-prompts-dialog";
import {
  BusabaseSidePanel,
  ConfirmActionDialog,
  EmptyState,
  RailToggleButton,
  SidebarPanel,
  SidebarRow,
  StatusBadge,
} from "./primitives";
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
  return (
    <div className="flex items-center gap-2">
      {/* Record-scoped Agent prompts. The View/Edit switch next to it is the
          record's whole toolbar, so this is the only place a per-record "ask my
          agent to fix THIS row" entry point can live. No `metadata` prop: a
          node's custom scenario prompts (node-agent-prompts-v2.md §7.3) only
          ever replace the WHOLE-NODE dialog's scenario tier, never a
          record/cell-scoped one (see `buildNodeAgentPrompts`'s `scope.kind`
          check) — passing it here would be inert even if `BaseVO` carried
          metadata, which it doesn't. */}
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
  const [, setLocation] = useLocation();
  const [panelOpen, setPanelOpen] = useState(true);
  const [deleteAction, setDeleteAction] = useState<"change_request" | "merge" | null>(null);
  const [confirmDeleteAction, setConfirmDeleteAction] = useState<"change_request" | "merge" | null>(
    null,
  );

  // Record lineage (the change requests that produced this record), via React
  // Query instead of a useEffect + setState fetch — it caches and refetches on
  // its own and exposes data/error/loading directly.
  const historyQuery = useQuery({
    enabled: Boolean(record) && !isAnon,
    queryFn: () => client.listRecordChangeRequests(record?.id ?? ""),
    queryKey: ["busabase", "record-change-requests", record?.id],
  });
  const historyChangeRequests = historyQuery.data ?? [];
  const historyError = historyQuery.error
    ? historyQuery.error instanceof Error
      ? historyQuery.error.message
      : messages.recordView.failedLoadHistory
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

  return (
    <div
      className="h-full min-h-0 w-full min-w-0 flex-1 overflow-auto overflow-x-hidden"
      data-record-detail-scroll
    >
      {!isAnon ? (
        <div className="flex items-center justify-end gap-2 px-6 pt-4">
          <details className="relative">
            <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&::-webkit-details-marker]:hidden">
              <MoreHorizontal size={16} />
            </summary>
            <div className="absolute right-0 z-50 mt-1 w-48 rounded-md border border-border/70 bg-card p-1 shadow-md">
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-medium text-foreground text-sm transition-colors hover:bg-accent"
                onClick={(event) => {
                  setLocation(`/base/${baseSlug}/${record.id}/activity`);
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
                  href={mergeSearchIntoHref("/activity", currentSearch)}
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
                <span className="rounded-md bg-muted/55 px-2 py-0.5 text-muted-foreground text-xs">
                  {isHistoryLoading ? "…" : historyChangeRequests.length}
                </span>
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
  const editorBase = base ?? record?.base ?? null;

  useEffect(() => {
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
  }, [editorBase, mode, record]);

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
        await onSubmitUpdate?.(record, normalizedFields, { mergeImmediately });
      }
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
              // On create there is nothing to enter for system/AI fields yet — hide them.
              // On edit they show (system read-only, AI editable) so values are visible.
              .filter((field) => mode === "edit" || !isHiddenOnCreate(field.type))
              .map((field) => (
                <RecordFieldInput
                  client={client}
                  editorInstanceKey={mode === "edit" && record ? record.id : "new"}
                  field={field}
                  key={field.id}
                  onChange={(value) =>
                    setFields((current) => ({ ...current, [field.slug]: value }))
                  }
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

/**
 * Options for a relation field. The records already in memory are NOT enough:
 * a Base is paged, so the record a user wants to link may simply not be loaded.
 * Typing queries the server (`contains` on the target Base's primary field),
 * and the already-selected records are always merged in so the control can
 * still render its own value.
 */
function RelationFieldEditor({
  client,
  field,
  inputId,
  fieldName,
  loadedRecords,
  onChange,
  value,
}: {
  client: BusabaseDashboardApiClient;
  field: BaseFieldVO;
  inputId: string;
  fieldName: string;
  loadedRecords: RecordVO[];
  onChange: (value: unknown) => void;
  value: string[];
}) {
  const messages = useCoreI18n();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const targetBaseId = field.options.targetBaseId;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // The target Base's primary field is what `getRecordTitle` renders, so it is
  // also what the user is typing against. The Base list is small and cached;
  // there is no single-Base read on this client.
  const basesQuery = useQuery({
    enabled: Boolean(targetBaseId),
    queryFn: () => client.listBases(),
    queryKey: ["busabase", "relation-bases"],
    staleTime: 60_000,
  });
  const targetBase = basesQuery.data?.find((base) => base.id === targetBaseId);
  const primarySlug = getPrimaryField(targetBase)?.slug;

  const optionsQuery = useQuery({
    enabled: Boolean(targetBaseId) && (!debouncedQuery || Boolean(primarySlug)),
    queryFn: () =>
      client.listRecordsPage({
        baseId: targetBaseId as string,
        pageSize: 50,
        ...(debouncedQuery && primarySlug
          ? {
              filters: [
                {
                  fieldSlug: primarySlug,
                  fieldType: "text" as const,
                  operator: "contains" as const,
                  value: debouncedQuery,
                },
              ],
            }
          : {}),
      }),
    queryKey: ["busabase", "relation-options", targetBaseId, primarySlug ?? "", debouncedQuery],
  });

  // Selected records must stay in the list even when they fall outside the
  // current search, or the browser drops them from the control's value.
  const selectedRecords = loadedRecords.filter((record) => value.includes(record.id));
  const seen = new Set(selectedRecords.map((record) => record.id));
  const options = [
    ...selectedRecords,
    ...(optionsQuery.data?.records ?? []).filter((record) => {
      if (seen.has(record.id)) return false;
      seen.add(record.id);
      return true;
    }),
  ];
  // A selected id whose record isn't loaded yet still needs an entry, otherwise
  // selecting anything else would silently drop it.
  const orphanIds = value.filter((id) => !seen.has(id));

  return (
    <div className="grid gap-1.5">
      <input
        aria-label={`${messages.base.searchRecordsToLink} — ${fieldName}`}
        className="h-9 w-full rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={messages.base.searchRecordsToLink}
        type="search"
        value={query}
      />
      <select
        aria-label={fieldName}
        className="min-h-9 w-full rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
        id={inputId}
        multiple={field.options.multiple ?? true}
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.selectedOptions).map(
            (option) => option.value,
          );
          onChange(field.options.multiple === false ? (selected[0] ?? "") : selected);
        }}
        // React requires a scalar for a single-select and an array for a
        // multi-select; passing an array to a single-select warns and leaves the
        // control unbound, so a single-relation field showed no current value.
        value={field.options.multiple === false ? (value[0] ?? "") : value}
      >
        {orphanIds.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {getRecordTitle(item, messages)}
          </option>
        ))}
      </select>
      {optionsQuery.isFetching ? (
        <span className="text-muted-foreground text-[11px]">{messages.common.loading}</span>
      ) : debouncedQuery && options.length === selectedRecords.length ? (
        <span className="text-muted-foreground text-[11px]">{messages.search.noMatchesTitle}</span>
      ) : null}
    </div>
  );
}

function RecordFieldInput({
  client,
  editorInstanceKey,
  field,
  onChange,
  onUploadAttachment,
  records,
  value,
}: {
  client: BusabaseDashboardApiClient;
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

  return (
    <div className="grid gap-3 border-border/40 border-b px-2 py-2.5 text-sm transition-colors hover:bg-muted/25 md:grid-cols-[180px_minmax(0,1fr)]">
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
      </div>
      {kind === "computed" ? (
        <div
          className="flex min-h-9 items-center rounded-md border border-border/40 bg-muted/40 px-2.5 py-1.5 text-muted-foreground text-sm"
          id={inputId}
        >
          {fieldValueToString(value) || (
            <span className="italic opacity-70">{messages.common.autoGenerated}</span>
          )}
        </div>
      ) : kind === "attachment" ? (
        <AttachmentFieldEditor
          field={field}
          inputId={inputId}
          onChange={onChange}
          onUploadAttachment={onUploadAttachment}
          value={value}
        />
      ) : kind === "relation" ? (
        <RelationFieldEditor
          client={client}
          field={field}
          fieldName={fieldName}
          inputId={inputId}
          loadedRecords={targetRecords}
          onChange={onChange}
          value={relationValue}
        />
      ) : kind === "select" ? (
        <select
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
        <TagFieldEditor inputId={inputId} label={fieldName} onChange={onChange} value={value} />
      ) : kind === "checkbox" ? (
        <label className="inline-flex h-9 items-center gap-2 text-muted-foreground text-sm">
          <input
            checked={value === true}
            id={inputId}
            onChange={(event) => onChange(event.target.checked)}
            type="checkbox"
          />
          {messages.recordView.checked}
        </label>
      ) : kind === "textarea" ? (
        <RichTextareaFieldEditor
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
      ) : (
        // Plain inputs — the registry's input kind doubles as the HTML input type
        // (text / number / date / url / email / tel).
        <input
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
  field,
  inputId,
  label,
  onChange,
  value,
}: {
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
          setEditorError(caught instanceof Error ? caught.message : messages.inbox.loadFailedTitle);
        }
      });
    return () => {
      active = false;
    };
  }, [messages.inbox.loadFailedTitle]);

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
  inputId,
  label,
  onChange,
  value,
}: {
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
  field,
  inputId,
  onChange,
  onUploadAttachment,
  value,
}: {
  field: BaseFieldVO;
  inputId: string;
  onChange: (value: unknown) => void;
  onUploadAttachment?: (file: File) => Promise<AssetAttachmentRef>;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const fieldName = resolveIString(field.name);
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
      setUploadError(error instanceof Error ? error.message : messages.recordView.uploadFailed);
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

/** Default value for a field that's never had a value entered — used on the create form. */
const defaultNewFieldValue = (fieldType: FieldType): unknown => {
  if (fieldType === "relation") return [];
  if (fieldType === "whiteboard") return structuredClone(EMPTY_WHITEBOARD_FIELD_VALUE);
  return "";
};

const getEditorFieldValue = (field: BaseFieldVO, value: unknown) => {
  if (field.type === "attachment") {
    return getAttachmentRefs(value);
  }
  if (field.type === "relation") {
    const relationIds = getRelationRecordIds(value);
    return field.options.multiple === false ? (relationIds[0] ?? "") : relationIds;
  }
  if (field.type === "multiselect" || field.type === "ai_tags") {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
  if (field.type === "checkbox") {
    return value === true || value === "true";
  }
  if (field.type === "whiteboard") {
    return parseWhiteboardFieldValue(value);
  }
  return fieldValueToString(value);
};

const normalizeEditorFields = (base: BaseVO, fields: Record<string, unknown>) =>
  Object.fromEntries(
    base.fields
      // System fields are computed server-side; never send them from the editor.
      .filter((field) => !isSystemFieldType(field.type))
      .map((field) => {
        const value = fields[field.slug];
        if (field.type === "attachment") {
          return [field.slug, getAttachmentRefs(value)];
        }
        if (field.type === "number") {
          const numberValue = typeof value === "number" ? value : Number(value);
          return [field.slug, Number.isFinite(numberValue) ? numberValue : null];
        }
        if (field.type === "checkbox") {
          return [field.slug, value === true || value === "true"];
        }
        if (field.type === "multiselect" || field.type === "relation" || field.type === "ai_tags") {
          return [
            field.slug,
            Array.isArray(value)
              ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
              : typeof value === "string" && value
                ? [value]
                : [],
          ];
        }
        if (field.type === "whiteboard") {
          // Re-validate/reshape defensively at submit time, same spirit as the
          // other structured types above — guarantees the server always
          // receives a well-formed { scene, previewSvg } value.
          return [field.slug, parseWhiteboardFieldValue(value)];
        }
        return [field.slug, value ?? ""];
      }),
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
      setError(mutationError instanceof Error ? mutationError.message : messages.comments.failed),
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
