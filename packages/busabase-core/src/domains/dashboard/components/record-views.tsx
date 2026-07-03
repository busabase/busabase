import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { Box, Check, GitMerge, MoreHorizontal, Paperclip, Trash2, X } from "lucide-react";
import type { AttachmentRef } from "open-domains/attachments/types";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useEffect, useState } from "react";
import { fmt, useCoreI18n, useIString } from "../../../i18n";
import {
  fieldDisplayKind,
  fieldInputKind,
  isHiddenOnCreate,
  isSystemFieldType,
} from "../../base/field-types";
import {
  getChangeRequestTitle,
  getRecordTitle,
  isDerivedFieldSlug,
  operationMeta,
} from "../helpers/change-request";
import {
  fieldPreviewText,
  getAttachmentRefs,
  getFieldChipEntries,
  getRecordFieldType,
  getRelationRecordIds,
  isRecordLongField,
  isRecordTitleField,
} from "../helpers/field";
import {
  fieldValueToString,
  formatActorLabel,
  formatAttachmentSize,
  formatDetailTime,
  shortIdentifier,
} from "../helpers/format";
import type { RecordSubmitOptions } from "../helpers/view-types";
import { FieldBadgeList, FieldValuePreview } from "./field-preview";
import {
  BusabaseSidePanel,
  ConfirmActionDialog,
  EmptyState,
  RailToggleButton,
  SidebarPanel,
  SidebarRow,
  StatusBadge,
} from "./primitives";
import { SplitSubmitButton } from "./split-submit-button";

// Record view/edit mode switch — lives in the titlebar (far right), mirroring the
// base detail's Records/Design switch.
export function RecordTopbarActions({
  activeTab,
  base,
  recordId,
}: {
  activeTab: "view" | "edit";
  base: BaseVO;
  recordId: string;
}) {
  return (
    <nav className="flex rounded-md bg-muted/60 p-0.5 text-xs">
      <Link
        className={`rounded px-2.5 py-1.5 font-medium transition-colors ${
          activeTab === "view"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        href={`/base/${base.slug}/${recordId}`}
      >
        View
      </Link>
      <Link
        className={`rounded px-2.5 py-1.5 font-medium transition-colors ${
          activeTab === "edit"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        href={`/base/${base.slug}/${recordId}/edit`}
      >
        Edit
      </Link>
    </nav>
  );
}

export function RecordDetailView({
  client,
  onDeleteChangeRequest,
  records,
  record,
}: {
  client: BusabaseDashboardApiClient;
  onDeleteChangeRequest: (record: RecordVO, options?: RecordSubmitOptions) => Promise<void>;
  records: RecordVO[];
  record: RecordVO | null;
}) {
  const messages = useCoreI18n();
  const [panelOpen, setPanelOpen] = useState(true);
  const [deleteAction, setDeleteAction] = useState<"change_request" | "merge" | null>(null);
  const [confirmDeleteAction, setConfirmDeleteAction] = useState<"change_request" | "merge" | null>(
    null,
  );

  // Record lineage (the change requests that produced this record), via React
  // Query instead of a useEffect + setState fetch — it caches and refetches on
  // its own and exposes data/error/loading directly.
  const historyQuery = useQuery({
    enabled: Boolean(record),
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
    <div className="min-h-0 flex-1 overflow-auto overflow-x-hidden">
      <div className="flex items-center justify-end gap-2 px-6 pt-4">
        <details className="relative">
          <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&::-webkit-details-marker]:hidden">
            <MoreHorizontal size={16} />
          </summary>
          <div className="absolute right-0 z-50 mt-1 w-48 rounded-md border border-border/70 bg-background p-1 shadow-md">
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-medium text-red-700 text-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-medium text-red-700 text-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
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
      <section className="grid w-full min-w-0 gap-6 px-6 pt-2 pb-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <main className="min-w-0 max-w-[860px] justify-self-center lg:w-full">
          <RecordHero record={record} />
          <RecordFieldPanel record={record} records={records} />
          <RecordCommentsPanel client={client} record={record} />
        </main>
        <BusabaseSidePanel open={panelOpen}>
          <SidebarPanel
            quiet
            title={messages.recordView.lineage}
            action={
              historyChangeRequests[0] ? (
                <Link
                  className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                  href={`/inbox/${historyChangeRequests[0].id}`}
                >
                  {messages.recordView.source}
                </Link>
              ) : undefined
            }
          >
            <SidebarRow
              label={messages.recordView.proposedBy}
              value={formatActorLabel(record.createdBy)}
            />
            <SidebarRow
              label={messages.recordView.commitAuthor}
              value={formatActorLabel(record.headCommit.author)}
            />
            <SidebarRow
              label={messages.common.updated}
              value={formatDetailTime(record.updatedAt)}
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
                className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                href="/activity"
              >
                {messages.recordView.seeAll}
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
              <span className="rounded-full bg-muted/55 px-2 py-0.5 text-muted-foreground text-xs">
                {isHistoryLoading ? "…" : historyChangeRequests.length}
              </span>
            }
          >
            {historyError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-red-800 text-xs">
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
            ) : (
              <div className="py-2 text-muted-foreground text-xs">
                {isHistoryLoading
                  ? messages.common.loading
                  : messages.recordView.noChangeRequestsYet}
              </div>
            )}
          </SidebarPanel>
        </BusabaseSidePanel>
      </section>
      <ConfirmActionDialog
        body={
          confirmDeleteAction === "merge"
            ? fmt(messages.recordView.deleteMergeBody, { title: getRecordTitle(record) })
            : fmt(messages.recordView.deleteRequestBody, { title: getRecordTitle(record) })
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
  mode,
  onSubmitCreate,
  onSubmitError,
  onSubmitUpdate,
  onUploadAttachment,
  records,
  record,
}: {
  base: BaseVO | null;
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
  onUploadAttachment?: (file: File) => Promise<AttachmentRef>;
  records: RecordVO[];
  record: RecordVO | null;
}) {
  const messages = useCoreI18n();
  const [fields, setFields] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      (base?.fields ?? record?.base.fields ?? []).map((field) => [
        field.slug,
        mode === "edit" && record
          ? getEditorFieldValue(field, record.headCommit.fields[field.slug])
          : field.type === "relation"
            ? []
            : "",
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
            ? getEditorFieldValue(field, record.headCommit.fields[field.slug])
            : field.type === "relation"
              ? []
              : "",
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
      if (mode === "new") {
        await onSubmitCreate?.(editorBase, normalizedFields, { mergeImmediately });
      } else if (record) {
        await onSubmitUpdate?.(record, normalizedFields, { mergeImmediately });
      }
    } catch (submitError) {
      onSubmitError(
        submitError instanceof Error
          ? submitError.message
          : messages.recordView.failedSaveChangeRequest,
      );
    } finally {
      setSaveAction(null);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
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
            className="rounded-md border border-border/70 bg-background px-3 py-1.5 font-medium text-xs transition-colors hover:bg-accent"
            href={
              mode === "edit" && record
                ? `/base/${record.base.slug}/${record.id}`
                : `/base/${editorBase.slug}`
            }
          >
            {messages.common.cancel}
          </Link>
          <SplitSubmitButton
            disabled={saveAction !== null}
            isPrimaryLoading={saveAction === "change_request"}
            isSecondaryLoading={saveAction === "merge"}
            primaryLabel={
              mode === "new" ? messages.recordView.submitRequest : messages.recordView.updateRequest
            }
            primaryLoadingLabel={messages.recordView.saving}
            secondaryLabel={
              mode === "new" ? messages.recordView.submitNow : messages.recordView.updateNow
            }
            secondaryLoadingLabel={messages.recordView.merging}
            onPrimary={() => submit(false)}
            onSecondary={() => submit(true)}
            hint={messages.common.mergeImmediatelyHint}
          />
        </div>
      </section>
    </div>
  );
}

function RecordFieldInput({
  field,
  onChange,
  onUploadAttachment,
  records,
  value,
}: {
  field: BaseFieldVO;
  onChange: (value: unknown) => void;
  onUploadAttachment?: (file: File) => Promise<AttachmentRef>;
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
          <span>{field.type}</span>
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
        <select
          aria-label={fieldName}
          className="min-h-9 w-full rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
          id={inputId}
          multiple={field.options.multiple ?? true}
          onChange={(event) => {
            const selected = Array.from(event.currentTarget.selectedOptions).map(
              (option) => option.value,
            );
            onChange(field.options.multiple === false ? (selected[0] ?? "") : selected);
          }}
          value={relationValue}
        >
          {targetRecords.map((item) => (
            <option key={item.id} value={item.id}>
              {getRecordTitle(item)}
            </option>
          ))}
        </select>
      ) : kind === "select" ? (
        <select
          aria-label={fieldName}
          className="h-9 w-full rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
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
          className="min-h-9 w-full rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
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
        <textarea
          aria-label={fieldName}
          className="min-h-28 w-full resize-y rounded-md border border-border/70 bg-background px-2.5 py-2 font-mono text-sm leading-6 outline-none transition-colors focus:border-primary"
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          value={fieldValueToString(value)}
        />
      ) : (
        // Plain inputs — the registry's input kind doubles as the HTML input type
        // (text / number / date / url / email / tel).
        <input
          aria-label={fieldName}
          className="h-9 w-full rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primary"
          id={inputId}
          type={kind}
          onChange={(event) => onChange(event.target.value)}
          value={fieldValueToString(value)}
        />
      )}
    </div>
  );
}

// Editable tag input (ai_tags): chips with remove buttons + a free-text entry.
// Enter / comma commits a tag, Backspace on an empty field removes the last.
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
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1.5 transition-colors focus-within:border-primary">
      {tags.map((tag) => (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-xs"
          key={tag}
        >
          {tag}
          <button
            aria-label={fmt(messages.recordView.remove, { name: tag })}
            className="text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => removeTag(tag)}
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
          } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
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
  onUploadAttachment?: (file: File) => Promise<AttachmentRef>;
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
      const uploaded: AttachmentRef[] = [];
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
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-border/70 border-dashed bg-background px-3 py-1.5 text-sm transition-colors hover:bg-accent"
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
          {attachments.map((item) => (
            <li
              className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 text-sm"
              key={item.id}
            >
              <Paperclip className="shrink-0 text-muted-foreground" size={13} />
              <a
                className="min-w-0 flex-1 truncate text-primary underline-offset-2 hover:underline"
                href={item.url}
                rel="noreferrer"
                target="_blank"
                title={item.fileName}
              >
                {item.fileName}
              </a>
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
          ))}
        </ul>
      ) : null}
    </div>
  );
}

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
        return [field.slug, value ?? ""];
      }),
  );

function RecordFieldPanel({ record, records }: { record: RecordVO; records: RecordVO[] }) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const allFieldEntries = record.base.fields.map((field) => ({
    field,
    value: record.headCommit.fields[field.slug],
  }));
  const propertyEntries = allFieldEntries.filter(
    ({ field, value }) => !isRecordTitleField(field) && !isRecordLongField(field, value),
  );
  const longFieldEntries = allFieldEntries.filter(
    ({ field, value }) => !isRecordTitleField(field) && isRecordLongField(field, value),
  );

  return (
    <section className="mt-5">
      {propertyEntries.length > 0 ? (
        <div className="mb-4 grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
          <div className="font-medium text-muted-foreground md:col-span-2">
            {messages.recordView.properties}
          </div>
          {propertyEntries.map(({ field, value }) => (
            <RecordPropertyItem field={field} key={field.id} records={records} value={value} />
          ))}
        </div>
      ) : null}

      {longFieldEntries.map(({ field, value }) => (
        <section className="mt-8 max-w-3xl" key={field.id}>
          <div className="font-medium text-muted-foreground text-sm">
            {resolveIString(field.name)}
          </div>
          <div className="mt-3 text-base leading-7">
            <FieldValuePreview
              className={
                field.type === "html" || field.type === "code"
                  ? "text-sm"
                  : "whitespace-pre-wrap text-foreground/95"
              }
              field={field}
              records={records}
              value={value}
            />
          </div>
        </section>
      ))}
    </section>
  );
}

function RecordPropertyItem({
  field,
  records,
  value,
}: {
  field: BaseFieldVO;
  records: RecordVO[];
  value: unknown;
}) {
  const resolveIString = useIString();
  const fieldName = resolveIString(field.name);
  if (fieldDisplayKind(field.type) === "checkbox") {
    const checked = value === true || value === "true";
    return (
      <div className="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-center gap-3">
        <span className="truncate text-muted-foreground">{fieldName}</span>
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
      <div className="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-start gap-3">
        <span className="truncate text-muted-foreground">{fieldName}</span>
        <FieldBadgeList chips={chips} />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-start gap-3">
      <span className="truncate text-muted-foreground">{fieldName}</span>
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
  const summary =
    fieldPreviewText(record.headCommit.fields.summary, getRecordFieldType(record, "summary")) ||
    fieldPreviewText(
      record.headCommit.fields.description,
      getRecordFieldType(record, "description"),
    );

  return (
    <div className="mt-2">
      <h1 className="max-w-4xl font-semibold text-4xl leading-tight tracking-tight">
        {getRecordTitle(record)}
      </h1>
      {summary ? (
        <p className="mt-3 max-w-3xl text-muted-foreground text-xl leading-snug">
          <span className="line-clamp-2">{summary}</span>
        </p>
      ) : null}
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
  const relatedOperations = changeRequest.operations.filter(
    (operation) =>
      operation.mergedRecordId === recordId ||
      operation.targetRecordId === recordId ||
      operation.sourceRecordId === recordId,
  );

  return (
    <Link
      className="block rounded-md border-border/40 border-b px-2 py-2.5 transition-colors hover:bg-muted/35"
      href={`/inbox/${changeRequest.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-sm">{getChangeRequestTitle(changeRequest)}</div>
          <div className="mt-1 text-muted-foreground text-xs">
            {changeRequest.submittedBy} · {new Date(changeRequest.updatedAt).toLocaleString()}
          </div>
        </div>
        <StatusBadge status={changeRequest.status} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {relatedOperations.map((operation) => (
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${operationMeta[operation.operation].tone}`}
            key={operation.id}
          >
            {operationMeta[operation.operation].label} · {shortIdentifier(operation.headCommitId)}
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
        authorId: "local-admin",
        body: text,
        mentionsAi: /(^|\s)@ai(\s|$)/i.test(text),
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
        <span className="rounded-full bg-muted/55 px-2.5 py-1 text-muted-foreground text-xs">
          {isLoading ? messages.common.loadingPlain : `${comments.length}`}
        </span>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">
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
                <div className="font-medium text-sm">{comment.authorId}</div>
                <div className="text-muted-foreground text-xs">
                  {new Date(comment.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                {comment.body}
              </div>
            </div>
          ))
        ) : (
          <div className="px-2 py-5 text-muted-foreground text-sm">
            {isLoading ? messages.comments.loading : messages.comments.noComments}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-md border border-border/70 bg-background/55 p-3">
        <textarea
          aria-label={messages.comments.addComment}
          className="min-h-20 w-full resize-y rounded-md border border-border/70 bg-background px-2.5 py-2 text-sm leading-6 outline-none transition-colors focus:border-primary"
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
