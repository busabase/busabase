import type {
  BaseFieldVO,
  BaseVO,
  RecordVO,
  ViewConfigVO,
  ViewFilterVO,
  ViewVO,
} from "busabase-contract/types";
import {
  Check,
  ChevronRight,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useState } from "react";
import { fieldColumnWidth, fieldDisplayKind } from "../../base/field-types";
import { getRecordTitle } from "../helpers/change-request";
import {
  fieldPreviewText,
  getAttachmentRefs,
  getFieldChipEntries,
  getFieldPreviewText,
  getRelationRecordIds,
} from "../helpers/field";
import { shortIdentifier } from "../helpers/format";
import type { ViewFormPayload, ViewSubmitOptions } from "../helpers/view-types";
import { FieldBadge } from "./field-preview";
import { ConfirmActionDialog } from "./primitives";
import { SplitSubmitButton } from "./split-submit-button";

const getRecordTableColumnWidth = (field: BaseFieldVO, index: number) => {
  if (index === 0) {
    return "minmax(260px,340px)";
  }
  if (["body", "content", "description"].includes(field.slug)) {
    return "minmax(280px,420px)";
  }
  return fieldColumnWidth(field.type);
};

const baseTableStickyClassName =
  "relative sticky left-0 z-10 bg-background pr-3 transition-colors after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-border/40 group-hover:bg-muted";

const baseTableHeaderStickyClassName =
  "relative sticky left-0 z-20 bg-background pr-3 after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-border/40";

export const applyViewConfigToRecords = (records: RecordVO[], config?: ViewConfigVO) => {
  if (!config) {
    return records;
  }

  const filtered = records.filter((record) =>
    config.filters.every((filter) => recordMatchesViewFilter(record, filter)),
  );
  return [...filtered].sort((left, right) => compareRecordsByViewSort(left, right, config));
};

const recordMatchesViewFilter = (record: RecordVO, filter: ViewFilterVO) => {
  const value = record.headCommit.fields[filter.fieldSlug];
  const text = fieldPreviewText(value).toLowerCase();
  const expected = fieldPreviewText(filter.value).toLowerCase();

  if (filter.operator === "contains") {
    return text.includes(expected);
  }
  if (filter.operator === "equals") {
    return text === expected;
  }
  if (filter.operator === "not_empty") {
    return text.length > 0 && text !== "-";
  }
  if (filter.operator === "is_empty") {
    return text.length === 0 || text === "-";
  }
  if (filter.operator === "is_true") {
    return value === true || value === "true";
  }
  if (filter.operator === "is_false") {
    return value === false || value === "false" || value === null || value === undefined;
  }
  return true;
};

const compareRecordsByViewSort = (left: RecordVO, right: RecordVO, config: ViewConfigVO) => {
  for (const sort of config.sorts) {
    const leftValue = fieldPreviewText(left.headCommit.fields[sort.fieldSlug]);
    const rightValue = fieldPreviewText(right.headCommit.fields[sort.fieldSlug]);
    const result = leftValue.localeCompare(rightValue, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (result !== 0) {
      return sort.direction === "asc" ? result : -result;
    }
  }
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
};

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function BusaBaseTable({
  activeView,
  archivedViews = [],
  archivedRecords = [],
  base,
  onCreateView,
  onDeleteView,
  onRestoreView,
  onRestoreRecord,
  onUpdateView,
  records,
  relationRecords = records,
  views,
}: {
  activeView: ViewVO | null;
  archivedViews?: ViewVO[];
  archivedRecords?: RecordVO[];
  base: BaseVO | null;
  onCreateView: (
    base: BaseVO,
    payload: ViewFormPayload,
    options?: ViewSubmitOptions,
  ) => Promise<void>;
  onDeleteView: (view: ViewVO) => Promise<void>;
  onRestoreView?: (view: ViewVO) => Promise<void>;
  onRestoreRecord?: (record: RecordVO) => Promise<void>;
  onUpdateView: (
    view: ViewVO,
    payload: ViewFormPayload,
    options?: ViewSubmitOptions,
  ) => Promise<void>;
  records: RecordVO[];
  relationRecords?: RecordVO[];
  views: ViewVO[];
}) {
  const [editingViewMode, setEditingViewMode] = useState<"create" | "edit" | null>(null);
  const [isDeletingView, setIsDeletingView] = useState(false);
  const [confirmDeleteView, setConfirmDeleteView] = useState<ViewVO | null>(null);
  const [viewActionError, setViewActionError] = useState<string | null>(null);
  const [showArchivedRecords, setShowArchivedRecords] = useState(false);
  const [restoringViewId, setRestoringViewId] = useState<string | null>(null);
  const [restoringRecordId, setRestoringRecordId] = useState<string | null>(null);
  const allFields = base?.fields ?? records[0]?.base.fields ?? [];
  const visibleFieldSlugs = activeView?.config.visibleFieldSlugs;
  const fields =
    Array.isArray(visibleFieldSlugs) && allFields.length
      ? visibleFieldSlugs
          .map((slug) => allFields.find((field) => field.slug === slug))
          .filter((field): field is BaseFieldVO => Boolean(field))
      : allFields;
  const fieldColumns = fields.map((field, index) => getRecordTableColumnWidth(field, index));
  const columnTemplate = [...fieldColumns, "96px", "96px"].join(" ");

  return (
    <div>
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {base ? (
            <Link
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-xs transition-colors ${
                activeView
                  ? "bg-muted/25 text-muted-foreground hover:bg-accent hover:text-foreground"
                  : "bg-background text-foreground shadow-sm"
              }`}
              href={`/base/${base.slug}`}
            >
              All
            </Link>
          ) : null}
          {views.map((view) => {
            const active = view.id === activeView?.id;
            return (
              <Link
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-xs transition-colors ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "bg-muted/25 text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                href={`/base/${base?.slug ?? ""}/${view.slug}`}
                key={view.id}
              >
                {view.name}
              </Link>
            );
          })}
          {base ? (
            <button
              aria-label="New view"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 border-dashed text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setEditingViewMode("create")}
              title="New view"
              type="button"
            >
              <Plus size={13} />
            </button>
          ) : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {records.length} record{records.length === 1 ? "" : "s"}
            {activeView && activeView.config.filters.length > 0
              ? ` · ${activeView.config.filters.length} filter${
                  activeView.config.filters.length === 1 ? "" : "s"
                }`
              : ""}
            {archivedRecords.length > 0 ? (
              <button
                className="ml-2 underline-offset-2 hover:underline"
                onClick={() => setShowArchivedRecords((v) => !v)}
                type="button"
              >
                {showArchivedRecords ? "Hide archived" : `${archivedRecords.length} archived`}
              </button>
            ) : null}
          </span>
          {activeView ? (
            <details className="relative">
              <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&::-webkit-details-marker]:hidden">
                <MoreHorizontal size={15} />
              </summary>
              <div className="absolute right-0 z-50 mt-1 w-40 rounded-md border border-border/70 bg-background p-1 shadow-md">
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-medium text-foreground text-xs transition-colors hover:bg-accent"
                  onClick={(event) => {
                    setEditingViewMode("edit");
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                  type="button"
                >
                  <PenLine size={13} />
                  Edit view
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-medium text-red-700 text-xs transition-colors hover:bg-red-50 disabled:opacity-60"
                  disabled={isDeletingView}
                  onClick={(event) => {
                    setConfirmDeleteView(activeView);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                  type="button"
                >
                  <Trash2 size={13} />
                  {isDeletingView ? "Deleting…" : "Delete view"}
                </button>
              </div>
            </details>
          ) : null}
          {base ? (
            <Link
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 font-medium text-background text-xs transition-colors hover:bg-foreground/85"
              href={`/base/${base.slug}/new`}
            >
              <Plus size={13} />
              New record
            </Link>
          ) : null}
        </div>
      </div>
      {base && editingViewMode ? (
        <ViewChangeRequestForm
          base={base}
          mode={editingViewMode}
          onCancel={() => setEditingViewMode(null)}
          onCreateView={onCreateView}
          onSubmitted={() => setEditingViewMode(null)}
          onUpdateView={onUpdateView}
          view={editingViewMode === "edit" ? activeView : null}
        />
      ) : null}
      {viewActionError ? <div className="mb-3 text-red-700 text-sm">{viewActionError}</div> : null}
      <ConfirmActionDialog
        body={
          confirmDeleteView
            ? `This creates a delete change request for "${confirmDeleteView.name}". The view remains available until that request is reviewed and merged.`
            : ""
        }
        confirmLabel="Create delete request"
        onCancel={() => setConfirmDeleteView(null)}
        onConfirm={() => {
          if (!confirmDeleteView) {
            return;
          }
          setIsDeletingView(true);
          setViewActionError(null);
          onDeleteView(confirmDeleteView)
            .then(() => setConfirmDeleteView(null))
            .catch((error) => {
              setViewActionError(error instanceof Error ? error.message : "Failed to delete view");
            })
            .finally(() => setIsDeletingView(false));
        }}
        open={confirmDeleteView !== null}
        pending={isDeletingView}
        title="Create delete request?"
      />
      {archivedViews.length > 0 ? (
        <details className="mb-3 rounded-md border border-border/50 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3 transition-transform details-open:rotate-90" />
            {archivedViews.length} archived view{archivedViews.length === 1 ? "" : "s"}
          </summary>
          <div className="divide-y divide-border/40 border-border/40 border-t">
            {archivedViews.map((view) => (
              <div className="flex items-center justify-between px-3 py-2" key={view.id}>
                <span className="text-muted-foreground">{view.name}</span>
                {onRestoreView ? (
                  <button
                    className="inline-flex items-center gap-1 rounded border border-border/60 bg-background px-2 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                    disabled={restoringViewId === view.id}
                    onClick={() => {
                      setRestoringViewId(view.id);
                      onRestoreView(view).finally(() => setRestoringViewId(null));
                    }}
                    type="button"
                  >
                    <RotateCcw className="size-3" />
                    {restoringViewId === view.id ? "Restoring…" : "Restore"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <div className="overflow-x-auto pb-5">
        <div className="w-max min-w-full">
          <div
            className="grid items-center gap-3 border-border/50 border-b px-2 py-2 text-muted-foreground text-xs"
            style={{ gridTemplateColumns: columnTemplate }}
          >
            {fields.map((field, index) => (
              <div
                className={`truncate ${index === 0 ? baseTableHeaderStickyClassName : ""}`}
                key={field.id}
                title={field.slug}
              >
                {field.name}
              </div>
            ))}
            <div>Record status</div>
            <div>Commit</div>
          </div>
          {records.length > 0 ? (
            records.map((record) => (
              <div
                className="group grid min-h-12 items-center gap-3 rounded-md border-border/40 border-b px-2 py-1.5 text-sm transition-colors hover:bg-muted/35"
                key={record.id}
                style={{ gridTemplateColumns: columnTemplate }}
              >
                {fields.map((field, index) => (
                  <RecordTableCell
                    currentRecordHref={`/base/${base?.slug ?? record.base.slug}/${record.id}`}
                    field={field}
                    index={index}
                    key={field.id}
                    record={record}
                    records={relationRecords}
                  />
                ))}
                <div className="min-w-0">
                  <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-muted/55 px-2 py-0.5 text-muted-foreground text-xs capitalize">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-55" />
                    <span className="truncate">{record.status}</span>
                  </span>
                </div>
                <div className="truncate font-mono text-muted-foreground/80 text-xs">
                  {shortIdentifier(record.headCommitId)}
                </div>
              </div>
            ))
          ) : (
            <div className="px-2 py-6 text-muted-foreground text-sm">
              Approved change requests appear here after merge.
            </div>
          )}
          {showArchivedRecords && archivedRecords.length > 0
            ? archivedRecords.map((record) => (
                <div
                  className="group grid min-h-12 items-center gap-3 rounded-md border-border/40 border-b bg-muted/10 px-2 py-1.5 text-sm opacity-60 transition-colors hover:opacity-100"
                  key={record.id}
                  style={{ gridTemplateColumns: columnTemplate }}
                >
                  {fields.map((field, index) => (
                    <RecordTableCell
                      currentRecordHref={`/base/${base?.slug ?? record.base.slug}/${record.id}`}
                      field={field}
                      index={index}
                      key={field.id}
                      record={record}
                      records={relationRecords}
                    />
                  ))}
                  <div className="min-w-0">
                    <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-muted/55 px-2 py-0.5 text-muted-foreground text-xs">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-55" />
                      archived
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {onRestoreRecord ? (
                      <button
                        className="inline-flex items-center gap-1 rounded border border-border/60 bg-background px-2 py-0.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                        disabled={restoringRecordId === record.id}
                        onClick={() => {
                          setRestoringRecordId(record.id);
                          onRestoreRecord(record).finally(() => setRestoringRecordId(null));
                        }}
                        type="button"
                      >
                        <RotateCcw className="size-3" />
                        {restoringRecordId === record.id ? "Restoring…" : "Restore"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            : null}
        </div>
      </div>
    </div>
  );
}

function ViewChangeRequestForm({
  base,
  mode,
  onCancel,
  onCreateView,
  onSubmitted,
  onUpdateView,
  view,
}: {
  base: BaseVO;
  mode: "create" | "edit";
  onCancel: () => void;
  onCreateView: (
    base: BaseVO,
    payload: ViewFormPayload,
    options?: ViewSubmitOptions,
  ) => Promise<void>;
  onSubmitted: () => void;
  onUpdateView: (
    view: ViewVO,
    payload: ViewFormPayload,
    options?: ViewSubmitOptions,
  ) => Promise<void>;
  view: ViewVO | null;
}) {
  const initialVisibleFieldSlugs =
    Array.isArray(view?.config.visibleFieldSlugs) && base.fields.length
      ? view.config.visibleFieldSlugs
      : base.fields.map((field) => field.slug);
  const [name, setName] = useState(view?.name ?? "");
  const [slug, setSlug] = useState(view?.slug ?? "");
  const [description, setDescription] = useState(view?.description ?? "");
  const [visibleFieldSlugs, setVisibleFieldSlugs] = useState(initialVisibleFieldSlugs);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (mode === "edit" && !view) {
    return null;
  }

  const toggleField = (fieldSlug: string, checked: boolean) => {
    setVisibleFieldSlugs((current) =>
      checked
        ? [...new Set([...current, fieldSlug])]
        : current.filter((item) => item !== fieldSlug),
    );
  };

  const submit = async (options?: ViewSubmitOptions) => {
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName) {
      setFormError("View name is required.");
      return;
    }
    if (mode === "create" && !trimmedSlug) {
      setFormError("View slug is required.");
      return;
    }
    const nextConfig: ViewConfigVO = {
      filters: view?.config.filters ?? [],
      sorts: view?.config.sorts ?? [],
      ...(visibleFieldSlugs.length === base.fields.length ? {} : { visibleFieldSlugs }),
    };

    setIsSaving(true);
    setFormError(null);
    try {
      if (mode === "create") {
        await onCreateView(
          base,
          {
            config: nextConfig,
            description: description.trim(),
            name: trimmedName,
            slug: trimmedSlug,
          },
          options,
        );
      } else if (view) {
        await onUpdateView(
          view,
          {
            config: nextConfig,
            description: description.trim(),
            name: trimmedName,
          },
          options,
        );
      }
      onSubmitted();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to submit view change request");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-border/70 bg-background px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-semibold text-sm">{mode === "create" ? "New View" : "Edit View"}</div>
        <button
          aria-label="Close view form"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onCancel}
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
        <label className="block">
          <span className="text-muted-foreground text-xs">Name</span>
          <input
            className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
            onChange={(event) => {
              setName(event.target.value);
              if (mode === "create" && !slug) {
                setSlug(toSlug(event.target.value));
              }
            }}
            value={name}
          />
        </label>
        <label className="block">
          <span className="text-muted-foreground text-xs">Slug</span>
          <input
            className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 font-mono text-sm outline-none transition-colors focus:border-primary disabled:bg-muted/40 disabled:text-muted-foreground"
            disabled={mode === "edit"}
            onChange={(event) => setSlug(toSlug(event.target.value))}
            value={slug}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-muted-foreground text-xs">Description</span>
          <textarea
            className="mt-1 min-h-16 w-full resize-y rounded-md border border-border/70 bg-background px-2.5 py-2 text-sm outline-none transition-colors focus:border-primary"
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </label>
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-muted-foreground text-xs">
            Visible fields · {visibleFieldSlugs.length}/{base.fields.length}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="rounded-md border border-border/70 bg-background px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setVisibleFieldSlugs([])}
              type="button"
            >
              Clear
            </button>
            <button
              className="rounded-md border border-border/70 bg-background px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setVisibleFieldSlugs(base.fields.map((field) => field.slug))}
              type="button"
            >
              Select all
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {base.fields.map((field) => (
            <label
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-muted/25 px-2.5 text-xs transition-colors hover:bg-muted/45"
              key={field.id}
            >
              <input
                checked={visibleFieldSlugs.includes(field.slug)}
                onChange={(event) => toggleField(field.slug, event.target.checked)}
                type="checkbox"
              />
              <span>{field.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-border/50 border-t pt-3">
        {formError ? <div className="text-red-700 text-sm">{formError}</div> : <div />}
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-border/70 bg-background px-3 py-1.5 font-medium text-xs transition-colors hover:bg-accent"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <SplitSubmitButton
            disabled={isSaving}
            isPrimaryLoading={isSaving}
            primaryLabel={mode === "create" ? "Add View Request" : "Update View Request"}
            primaryLoadingLabel="Submitting..."
            secondaryLabel={mode === "create" ? "Add View Now" : "Update View Now"}
            secondaryLoadingLabel="Merging..."
            onPrimary={() => submit()}
            onSecondary={() => submit({ mergeImmediately: true })}
            hint="Request goes to your inbox for review. Now merges immediately."
          />
        </div>
      </div>
    </div>
  );
}

function RecordTableCell({
  currentRecordHref,
  field,
  index,
  record,
  records,
}: {
  currentRecordHref: string;
  field: BaseFieldVO;
  index: number;
  record: RecordVO;
  records: RecordVO[];
}) {
  const rawValue = record.headCommit.fields[field.slug];
  const stickyClassName = index === 0 ? baseTableStickyClassName : "";
  const chips = getFieldChipEntries(field, rawValue);
  const kind = fieldDisplayKind(field.type);

  if (kind === "checkbox") {
    const checked = rawValue === true || rawValue === "true";
    return (
      <Link
        className={`flex min-w-0 items-center py-1 ${
          index === 0 ? stickyClassName : "text-muted-foreground"
        }`}
        href={currentRecordHref}
        title={checked ? "Yes" : "No"}
      >
        <span
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
            checked
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border/70 bg-muted/30 text-muted-foreground"
          }`}
        >
          {checked ? <Check size={12} /> : null}
        </span>
      </Link>
    );
  }

  if (chips.length > 0) {
    return (
      <Link
        className={`flex min-w-0 flex-wrap gap-1.5 py-1 ${index === 0 ? stickyClassName : ""}`}
        href={currentRecordHref}
        title={chips.map((chip) => chip.label).join(", ")}
      >
        {chips.slice(0, 3).map((chip, chipIndex) => (
          <FieldBadge chip={chip} key={`${chip.label}:${chipIndex}`} />
        ))}
        {chips.length > 3 ? (
          <span className="rounded-full bg-muted/50 px-2 py-0.5 text-muted-foreground text-xs">
            +{chips.length - 3}
          </span>
        ) : null}
      </Link>
    );
  }

  if (kind === "attachment") {
    const attachments = getAttachmentRefs(rawValue);
    if (attachments.length === 0) {
      return (
        <div
          className={`min-w-0 truncate py-1 text-muted-foreground text-sm ${stickyClassName}`}
          title="-"
        >
          -
        </div>
      );
    }
    const tableImages = attachments.filter((a) => a.mimeType?.startsWith("image/"));
    const tableOthers = attachments.filter((a) => !a.mimeType?.startsWith("image/"));
    return (
      <div
        className={`flex min-w-0 flex-wrap items-center gap-1.5 py-1 ${stickyClassName}`}
        title={attachments.map((item) => item.fileName).join(", ")}
      >
        {tableImages.slice(0, 3).map((item) => (
          <img
            alt={item.fileName}
            className="h-8 w-auto max-w-[6rem] rounded border object-cover"
            key={item.id}
            src={item.url}
            title={item.fileName}
          />
        ))}
        {tableOthers.slice(0, Math.max(0, 3 - tableImages.length)).map((item) => (
          <span
            className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-muted/70 px-2 py-0.5 text-foreground text-xs"
            key={item.id}
          >
            <Paperclip className="shrink-0" size={11} />
            <span className="truncate">{item.fileName}</span>
          </span>
        ))}
        {attachments.length > 3 ? (
          <span className="rounded-full bg-muted/50 px-2 py-0.5 text-muted-foreground text-xs">
            +{attachments.length - 3}
          </span>
        ) : null}
      </div>
    );
  }

  if (kind === "relation") {
    const relationIds = getRelationRecordIds(rawValue);
    if (relationIds.length === 0) {
      return (
        <div
          className={`min-w-0 truncate py-1 text-muted-foreground text-sm ${stickyClassName}`}
          title="-"
        >
          -
        </div>
      );
    }

    return (
      <div className={`flex min-w-0 flex-wrap gap-1.5 py-1 ${stickyClassName}`}>
        {relationIds.map((recordId) => {
          const linkedRecord = records.find((item) => item.id === recordId);
          const label = linkedRecord ? getRecordTitle(linkedRecord) : shortIdentifier(recordId);
          const chipClassName = "max-w-full truncate rounded-full bg-muted/70 px-2 py-0.5 text-xs";
          return linkedRecord ? (
            <Link
              className={`${chipClassName} text-primary transition-colors hover:bg-primary/10 hover:underline`}
              href={`/base/${linkedRecord.base.slug}/${linkedRecord.id}`}
              key={recordId}
              title={label}
            >
              {label}
            </Link>
          ) : (
            <span
              className={`${chipClassName} text-muted-foreground`}
              key={recordId}
              title={recordId}
            >
              {label}
            </span>
          );
        })}
      </div>
    );
  }

  const value = getFieldPreviewText(field, rawValue);

  return (
    <Link
      className={`flex min-w-0 items-center gap-2 py-1 underline-offset-2 hover:underline ${
        index === 0 ? `${stickyClassName} font-medium text-foreground` : "text-muted-foreground"
      }`}
      href={currentRecordHref}
      title={value}
    >
      {index === 0 ? (
        <span className="h-4 w-4 shrink-0 rounded border border-border/70 bg-muted/40" />
      ) : null}
      <span className="min-w-0 truncate">{value || "-"}</span>
      {index === 0 ? (
        <ChevronRight
          className="ml-auto shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          size={13}
        />
      ) : null}
    </Link>
  );
}
