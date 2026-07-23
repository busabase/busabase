import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  BaseFieldVO,
  BaseVO,
  GalleryCardSize,
  GalleryCoverFit,
  GanttScale,
  RecordVO,
  ViewConfigVO,
  ViewFilterVO,
  ViewType,
  ViewVO,
} from "busabase-contract/types";
import { VIEW_FIELD_MIN_WIDTH } from "busabase-contract/types";
import { Dialog, DialogContent, DialogTitle } from "kui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { Skeleton } from "kui/skeleton";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronRight,
  Columns3,
  ExternalLink,
  EyeOff,
  Filter,
  GanttChart,
  LayoutGrid,
  LoaderCircle,
  MoreHorizontal,
  MoveLeft,
  MoveRight,
  Paperclip,
  PenLine,
  PlaySquare,
  Plus,
  RotateCcw,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useSearch } from "wouter";
import { fmt, useCoreI18n, useIString } from "../../../i18n";
import { fieldColumnWidth, fieldDisplayKind, fieldLabel } from "../../base/field-types";
import { resolveEmbedPreview } from "../../base/utils/embed";
import { getRecordTitle } from "../helpers/change-request";
import {
  fieldPreviewText,
  getAttachmentRefs,
  getFieldChipEntries,
  getFieldPreviewText,
  getRelationRecordIds,
  getSafeAttachmentUrl,
} from "../helpers/field";
import { fieldValueToString, shortIdentifier } from "../helpers/format";
import { mergeSearchIntoHref, useHrefWithCurrentSearch } from "../helpers/link-search";
import {
  clampViewFieldWidth,
  getVisibleViewFieldSlugs,
  hideViewField,
  matchesViewField,
  moveViewField,
  resetViewFieldWidth,
  setViewFieldWidth,
} from "../helpers/view-config";
import type { RecordsPagination, ViewFormPayload, ViewSubmitOptions } from "../helpers/view-types";
import { BusaBaseCalendar } from "./base-calendar";
import { BusaBaseGallery } from "./base-gallery";
import { BusaBaseGantt } from "./base-gantt";
import { BusaBaseKanban } from "./base-kanban";
import { FieldBadge } from "./field-preview";
import { ConfirmActionDialog } from "./primitives";
import { SplitSubmitButton } from "./split-submit-button";
import {
  FIELD_TYPE_ICONS,
  ViewConfigEditorDialog,
  type ViewConfigEditorRequest,
  ViewConfigToolbar,
  ViewFieldsEditor,
} from "./view-config-editor";

// Per-view-type tab glyph (kept in one place so tabs and the type picker agree).
function ViewTypeIcon({ type }: { type: ViewType }) {
  const className = "shrink-0 opacity-70";
  if (type === "gallery") {
    return <LayoutGrid className={className} size={12} />;
  }
  if (type === "kanban") {
    return <Columns3 className={className} size={12} />;
  }
  if (type === "calendar") {
    return <CalendarDays className={className} size={12} />;
  }
  if (type === "gantt") {
    return <GanttChart className={className} size={12} />;
  }
  return <Table2 className={className} size={12} />;
}

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
  "sticky left-0 z-10 border-border/70 border-r bg-background shadow-sm transition-colors group-hover:bg-muted";

const baseTableHeaderStickyClassName =
  "sticky left-0 z-20 border-border/70 border-r bg-muted shadow-sm";

const baseTableStatusCellClassName =
  "flex min-w-0 items-center overflow-hidden border-border/70 border-l bg-background px-2 md:sticky md:right-0 md:z-10 group-hover:bg-muted";

const baseTableStatusHeaderClassName =
  "flex items-center border-border/70 border-l bg-muted px-2 font-medium md:sticky md:right-0 md:z-30";

function FieldColumnHeader({
  actionsDisabled,
  activeView,
  allFields,
  baseSlug,
  busy,
  field,
  canMoveLeft,
  canMoveRight,
  customWidth,
  dragOver,
  dragging,
  name,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop,
  onCreateView,
  onMove,
  onOpenViewEditor,
  onQuickUpdate,
  onResizeCancel,
  onResizeCommit,
  onResizePreview,
  sticky,
}: {
  actionsDisabled: boolean;
  activeView: ViewVO | null;
  allFields: BaseFieldVO[];
  baseSlug: string;
  busy: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  customWidth?: number;
  dragOver: boolean;
  dragging: boolean;
  field: BaseFieldVO;
  name: string;
  onDragEnd: () => void;
  onDragLeave: () => void;
  onDragOver: (placement: "before" | "after") => void;
  onDragStart: () => void;
  onDrop: (sourceSlug: string, placement: "before" | "after") => void;
  onCreateView: () => void;
  onMove: (direction: "left" | "right") => void;
  onOpenViewEditor: (section: "filters" | "sorts", fieldId: string) => void;
  onQuickUpdate: (config: ViewConfigVO) => Promise<boolean>;
  onResizeCancel: () => void;
  onResizeCommit: (width: number) => void;
  onResizePreview: (width: number) => void;
  sticky: boolean;
}) {
  const messages = useCoreI18n();
  const currentSearch = useSearch();
  const Icon = FIELD_TYPE_ICONS[field.type];
  const metadata = `${name} - ${fieldLabel(field.type)} (${field.slug})`;
  const activeSort = activeView?.config.sorts.find((sort) => matchesViewField(sort, field));
  const activeFilter = activeView?.config.filters.find((filter) => matchesViewField(filter, field));
  const [open, setOpen] = useState(false);
  const visibleFieldCount = activeView
    ? getVisibleViewFieldSlugs(activeView.config, allFields).length
    : allFields.length;
  const resizeSession = useRef<{ startWidth: number; startX: number; width: number } | null>(null);

  const getDropPlacement = (event: DragEvent<HTMLDivElement>): "before" | "after" => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  };

  const startResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (!activeView || actionsDisabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const header = event.currentTarget.parentElement;
    const startWidth = customWidth ?? header?.getBoundingClientRect().width ?? VIEW_FIELD_MIN_WIDTH;
    resizeSession.current = { startWidth, startX: event.clientX, width: startWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const previewResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (!resizeSession.current) {
      return;
    }
    const width = clampViewFieldWidth(
      resizeSession.current.startWidth + event.clientX - resizeSession.current.startX,
    );
    resizeSession.current.width = width;
    onResizePreview(width);
  };

  const finishResize = (event: PointerEvent<HTMLButtonElement>) => {
    const session = resizeSession.current;
    if (!session) {
      return;
    }
    resizeSession.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (Math.round(session.startWidth) === session.width) {
      onResizeCancel();
      return;
    }
    onResizeCommit(session.width);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      !activeView ||
      actionsDisabled ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    ) {
      return;
    }
    event.preventDefault();
    const current = customWidth ?? event.currentTarget.parentElement?.getBoundingClientRect().width;
    if (current === undefined) {
      return;
    }
    const step = event.shiftKey ? 32 : 16;
    const width = clampViewFieldWidth(current + (event.key === "ArrowRight" ? step : -step));
    onResizePreview(width);
    onResizeCommit(width);
  };

  const runUpdate = async (config: ViewConfigVO) => {
    if (await onQuickUpdate(config)) {
      setOpen(false);
    }
  };

  return (
    <div
      aria-label={metadata}
      aria-sort={
        activeSort?.direction === "asc"
          ? "ascending"
          : activeSort?.direction === "desc"
            ? "descending"
            : undefined
      }
      className={`group/header relative flex h-full min-w-0 items-center gap-1 border-border/40 border-r px-1.5 font-medium ${
        sticky ? baseTableHeaderStickyClassName : ""
      } ${dragOver ? "ring-2 ring-inset ring-primary/60" : ""} ${dragging ? "opacity-55" : ""}`}
      data-field-slug={field.slug}
      data-field-width={customWidth}
      data-reorder-target={dragOver ? "true" : undefined}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onDragLeave();
        }
      }}
      onDragOver={(event) => {
        if (!activeView || actionsDisabled || dragging) {
          return;
        }
        event.preventDefault();
        onDragOver(getDropPlacement(event));
      }}
      onDrop={(event) => {
        if (!activeView || actionsDisabled || dragging) {
          return;
        }
        event.preventDefault();
        onDrop(event.dataTransfer.getData("text/plain"), getDropPlacement(event));
      }}
      role="columnheader"
      tabIndex={-1}
      title={metadata}
    >
      {activeView ? (
        <button
          aria-label={fmt(messages.base.dragFieldAria, { name })}
          className="hidden size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-35 md:inline-flex"
          data-testid={`field-drag-handle-${field.slug}`}
          disabled={actionsDisabled}
          draggable={!actionsDisabled}
          onDragEnd={onDragEnd}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", field.slug);
            onDragStart();
          }}
          title={fmt(messages.base.dragFieldAria, { name })}
          type="button"
        >
          <Icon
            aria-hidden="true"
            className="size-3.5 text-muted-foreground/80"
            data-field-type-icon={field.type}
          />
        </button>
      ) : (
        <Icon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground/80"
          data-field-type-icon={field.type}
        />
      )}
      <span className="truncate">{name}</span>
      <span className="relative ml-auto size-7 shrink-0">
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            <button
              aria-label={fmt(messages.base.fieldActionsAria, { name })}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              data-testid={`field-header-actions-${field.slug}`}
              disabled={actionsDisabled}
              title={fmt(messages.base.fieldActionsAria, { name })}
              type="button"
            >
              {busy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <MoreHorizontal className="size-3.5" />
              )}
            </button>
          </PopoverTrigger>
          {activeFilter ? (
            <Filter
              aria-label={messages.base.fieldFilterActive}
              className="pointer-events-none absolute -left-0.5 top-0 size-3 text-primary"
              data-field-filter-active
            />
          ) : null}
          {activeSort?.direction === "asc" ? (
            <ArrowUp
              aria-hidden="true"
              className="pointer-events-none absolute -left-0.5 bottom-0 size-3 text-foreground"
            />
          ) : activeSort?.direction === "desc" ? (
            <ArrowDown
              aria-hidden="true"
              className="pointer-events-none absolute -left-0.5 bottom-0 size-3 text-foreground"
            />
          ) : null}
          <PopoverContent align="end" className="w-72 p-0" sideOffset={4}>
            {!activeView ? (
              <div className="p-3">
                <p className="text-muted-foreground text-xs leading-5">
                  {messages.base.savedViewRequired}
                </p>
                <button
                  className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 font-medium text-background text-xs transition-colors hover:bg-foreground/85"
                  onClick={() => {
                    setOpen(false);
                    onCreateView();
                  }}
                  type="button"
                >
                  <Plus className="size-3.5" />
                  {messages.base.newView}
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border/60 text-xs">
                <div className="p-2">
                  <div className="mb-1 px-2 font-medium text-muted-foreground">
                    {messages.base.moveField}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      aria-label={messages.base.moveFieldLeft}
                      className="flex h-8 items-center justify-center gap-1.5 rounded transition-colors hover:bg-accent disabled:opacity-40"
                      disabled={actionsDisabled || !canMoveLeft}
                      onClick={() => {
                        onMove("left");
                        setOpen(false);
                      }}
                      type="button"
                    >
                      <MoveLeft className="size-3.5" />
                      {messages.base.moveFieldLeft}
                    </button>
                    <button
                      aria-label={messages.base.moveFieldRight}
                      className="flex h-8 items-center justify-center gap-1.5 rounded transition-colors hover:bg-accent disabled:opacity-40"
                      disabled={actionsDisabled || !canMoveRight}
                      onClick={() => {
                        onMove("right");
                        setOpen(false);
                      }}
                      type="button"
                    >
                      {messages.base.moveFieldRight}
                      <MoveRight className="size-3.5" />
                    </button>
                  </div>
                  <button
                    className="mt-1 flex h-8 w-full items-center gap-2 rounded px-2 text-left transition-colors hover:bg-accent disabled:opacity-40"
                    disabled={
                      actionsDisabled || activeView.config.fieldWidths?.[field.slug] === undefined
                    }
                    onClick={() => runUpdate(resetViewFieldWidth(activeView.config, field.slug))}
                    type="button"
                  >
                    <RotateCcw className="size-3.5" />
                    {messages.base.resetFieldWidth}
                  </button>
                </div>
                <div className="p-2">
                  <button
                    className="flex h-8 w-full items-center gap-2 rounded px-2 text-left transition-colors hover:bg-accent"
                    data-testid={`header-view-filter-${field.slug}`}
                    onClick={() => {
                      setOpen(false);
                      onOpenViewEditor("filters", field.id);
                    }}
                    type="button"
                  >
                    <Filter className="size-3.5" />
                    {messages.base.editFieldFilter}
                  </button>
                  <button
                    className="flex h-8 w-full items-center gap-2 rounded px-2 text-left transition-colors hover:bg-accent"
                    data-testid={`header-view-sort-${field.slug}`}
                    onClick={() => {
                      setOpen(false);
                      onOpenViewEditor("sorts", field.id);
                    }}
                    type="button"
                  >
                    <ArrowUpDown className="size-3.5" />
                    {messages.base.editFieldSort}
                  </button>
                </div>

                <div className="p-2">
                  <button
                    className="flex h-8 w-full items-center gap-2 rounded px-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
                    disabled={actionsDisabled || visibleFieldCount <= 1}
                    onClick={() => runUpdate(hideViewField(activeView.config, field, allFields))}
                    title={visibleFieldCount <= 1 ? messages.base.cannotHideLastField : undefined}
                    type="button"
                  >
                    <EyeOff className="size-3.5" />
                    {messages.base.hideField}
                  </button>
                  <Link
                    className="flex h-8 w-full items-center gap-2 rounded px-2 transition-colors hover:bg-accent"
                    href={mergeSearchIntoHref(`/base/${baseSlug}/design`, currentSearch)}
                    onClick={() => setOpen(false)}
                  >
                    <PenLine className="size-3.5" />
                    {messages.base.editField}
                  </Link>
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </span>
      {activeView ? (
        <button
          aria-keyshortcuts="ArrowLeft ArrowRight"
          aria-label={fmt(messages.base.resizeFieldAria, { name })}
          className="absolute inset-y-0 right-0 z-30 hidden w-2 translate-x-1/2 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30 md:flex"
          data-testid={`field-resize-handle-${field.slug}`}
          disabled={actionsDisabled}
          onKeyDown={resizeWithKeyboard}
          onPointerCancel={() => {
            resizeSession.current = null;
            onResizeCancel();
          }}
          onPointerDown={startResize}
          onPointerMove={previewResize}
          onPointerUp={finishResize}
          title={fmt(messages.base.resizeFieldAria, { name })}
          type="button"
        >
          <span className="h-4 w-px bg-border transition-colors group-hover/header:bg-foreground/40" />
        </button>
      ) : null}
    </div>
  );
}

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

const toSlugInput = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/g, "");

// Above this many rows the records list is virtualized (windowed).
const VIRTUALIZE_ROW_THRESHOLD = 100;

// One canonical record row, shared by the plain and virtualized render paths.
// `style` carries the absolute-positioning transform when virtualized.
function BusaBaseRecordRow({
  record,
  fields,
  columnTemplate,
  baseSlug,
  relationRecords,
  rowIndex,
  style,
}: {
  record: RecordVO;
  fields: BaseFieldVO[];
  columnTemplate: string;
  baseSlug?: string;
  relationRecords: RecordVO[];
  rowIndex: number;
  style?: CSSProperties;
}) {
  const currentRecordHref = useHrefWithCurrentSearch(
    `/base/${baseSlug ?? record.base.slug}/${record.id}`,
  );
  return (
    <div
      aria-rowindex={rowIndex}
      className="group grid h-12 items-stretch border-border/40 border-b text-sm transition-colors hover:bg-muted/35"
      data-record-id={record.id}
      role="row"
      style={{ gridTemplateColumns: columnTemplate, ...style }}
      tabIndex={-1}
    >
      {fields.map((field, index) => (
        <RecordTableCell
          currentRecordHref={currentRecordHref}
          field={field}
          index={index}
          key={field.id}
          record={record}
          records={relationRecords}
        />
      ))}
      <div className={baseTableStatusCellClassName} role="gridcell" tabIndex={-1}>
        <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-muted/55 px-2 py-0.5 text-muted-foreground text-xs capitalize">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-55" />
          <span className="truncate">{record.status}</span>
        </span>
      </div>
    </div>
  );
}

// Stable ids + cycling widths for the loading-rows skeleton below, following the
// same static-array convention as skeletons.tsx (deterministic, no index keys).
const SKELETON_ROWS = [
  "skel-row-1",
  "skel-row-2",
  "skel-row-3",
  "skel-row-4",
  "skel-row-5",
  "skel-row-6",
];
const SKELETON_CELL_WIDTHS = ["80%", "60%", "72%", "55%", "66%"];

// Body-only loading placeholder shown while the active base's first page of
// records is still in flight. Mirrors the real rows' column template so the
// table doesn't jump when data arrives, and — unlike the page-level
// BaseTableSkeleton — leaves the already-loaded header/view-tabs/toolbar above
// it alone instead of replacing them with a fake shimmer.
function BusaBaseTableRowsSkeleton({ columnTemplate }: { columnTemplate: string }) {
  return (
    <div aria-hidden>
      {SKELETON_ROWS.map((rowId, rowIndex) => (
        <div
          className="grid h-12 items-center overflow-hidden border-border/40 border-b"
          key={rowId}
          style={{ gridTemplateColumns: columnTemplate }}
        >
          {columnTemplate.split(" ").map((column, columnIndex, columns) => (
            <div
              className={
                columnIndex === 0
                  ? baseTableStickyClassName
                  : columnIndex === columns.length - 1
                    ? baseTableStatusCellClassName
                    : "flex h-full items-center border-border/40 border-r"
              }
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-order grid cells, no stable id
              key={`${rowId}-${column}-${columnIndex}`}
            >
              <Skeleton
                className="mx-2 h-4"
                style={{
                  width:
                    SKELETON_CELL_WIDTHS[(rowIndex + columnIndex) % SKELETON_CELL_WIDTHS.length],
                }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function BusaBaseTable({
  activeView,
  archivedViews = [],
  archivedRecords = [],
  archivedPagination,
  base,
  onCreateView,
  onDeleteView,
  onRestoreView,
  onRestoreRecord,
  onMoveRecord,
  onPatchRecord,
  onUpdateView,
  records,
  relationRecords = records,
  pagination,
  scrollElementRef,
  views,
}: {
  activeView: ViewVO | null;
  archivedViews?: ViewVO[];
  archivedRecords?: RecordVO[];
  archivedPagination?: { hasMore: boolean; isLoadingMore: boolean; loadMore: () => void };
  base: BaseVO | null;
  onCreateView: (
    base: BaseVO,
    payload: ViewFormPayload,
    options?: ViewSubmitOptions,
  ) => Promise<void>;
  onDeleteView: (view: ViewVO) => Promise<void>;
  onRestoreView?: (view: ViewVO) => Promise<void>;
  onRestoreRecord?: (record: RecordVO) => Promise<void>;
  /** Kanban drag-to-move: set one field on a record and auto-merge, no navigation. */
  onMoveRecord?: (record: RecordVO, fieldSlug: string, value: string | null) => Promise<void>;
  /** Gantt drag-to-reschedule: patch several fields at once and auto-merge, no navigation. */
  onPatchRecord?: (record: RecordVO, patch: Record<string, unknown>) => Promise<void>;
  onUpdateView: (
    view: ViewVO,
    payload: ViewFormPayload,
    options?: ViewSubmitOptions,
  ) => Promise<void>;
  records: RecordVO[];
  relationRecords?: RecordVO[];
  pagination?: RecordsPagination;
  scrollElementRef: RefObject<HTMLElement | null>;
  views: ViewVO[];
}) {
  const messages = useCoreI18n();
  const currentSearch = useSearch();
  const resolveIString = useIString();
  const [editingViewMode, setEditingViewMode] = useState<"create" | "edit" | null>(null);
  const [isDeletingView, setIsDeletingView] = useState(false);
  const [confirmDeleteView, setConfirmDeleteView] = useState<ViewVO | null>(null);
  const [viewActionError, setViewActionError] = useState<string | null>(null);
  const [showArchivedRecords, setShowArchivedRecords] = useState(false);
  const [restoringViewId, setRestoringViewId] = useState<string | null>(null);
  const [restoringRecordId, setRestoringRecordId] = useState<string | null>(null);
  const [quickUpdatingFieldId, setQuickUpdatingFieldId] = useState<string | null>(null);
  const [viewEditorRequest, setViewEditorRequest] = useState<ViewConfigEditorRequest | null>(null);
  const [columnWidthDrafts, setColumnWidthDrafts] = useState<Record<string, number>>({});
  const [draggingFieldSlug, setDraggingFieldSlug] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    placement: "before" | "after";
    slug: string;
  } | null>(null);
  const allFields = base?.fields ?? records[0]?.base.fields ?? [];
  const fields = activeView
    ? getVisibleViewFieldSlugs(activeView.config, allFields)
        .map((slug) => allFields.find((field) => field.slug === slug))
        .filter((field): field is BaseFieldVO => Boolean(field))
    : allFields;
  const fieldColumns = fields.map((field, index) => {
    const width = columnWidthDrafts[field.slug] ?? activeView?.config.fieldWidths?.[field.slug];
    return width === undefined ? getRecordTableColumnWidth(field, index) : `${width}px`;
  });
  const columnTemplate = [...fieldColumns, "112px"].join(" ");

  // biome-ignore lint/correctness/useExhaustiveDependencies: a merged View revision invalidates transient drag/resize state.
  useEffect(() => {
    setColumnWidthDrafts({});
    setDraggingFieldSlug(null);
    setDropTarget(null);
  }, [activeView?.id, activeView?.updatedAt]);

  const quickUpdateView = async (config: ViewConfigVO): Promise<boolean> => {
    if (!activeView || quickUpdatingFieldId) {
      return false;
    }
    setViewActionError(null);
    try {
      await onUpdateView(
        activeView,
        {
          config,
          description: activeView.description,
          name: activeView.name,
          type: activeView.type,
        },
        { mergeImmediately: true },
      );
      return true;
    } catch (error) {
      setViewActionError(
        error instanceof Error ? error.message : messages.base.failedQuickViewUpdate,
      );
      return false;
    } finally {
      setQuickUpdatingFieldId(null);
    }
  };

  const submitViewControls = async (config: ViewConfigVO, options?: ViewSubmitOptions) => {
    if (!activeView) {
      return;
    }
    setViewActionError(null);
    await onUpdateView(
      activeView,
      {
        config,
        description: activeView.description,
        name: activeView.name,
        type: activeView.type,
      },
      options,
    );
  };

  // Virtualize only long lists (small tables — the common case — render plainly
  // and are untouched). Rows are absolutely positioned inside a spacer; the grid
  // template + sticky first column are preserved.
  const shouldVirtualize = records.length > VIRTUALIZE_ROW_THRESHOLD;
  const tableRootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [listScrollMargin, setListScrollMargin] = useState(0);
  const getScrollElement = useCallback(() => scrollElementRef.current, [scrollElementRef]);
  // Measure where the row list starts relative to the (ancestor) scroll viewport,
  // so virtualized rows sit correctly beneath the base header + toolbar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the list toggles / row count changes.
  useLayoutEffect(() => {
    const scrollEl = getScrollElement();
    if (shouldVirtualize && listRef.current && scrollEl) {
      const margin =
        listRef.current.getBoundingClientRect().top -
        scrollEl.getBoundingClientRect().top +
        scrollEl.scrollTop;
      setListScrollMargin(margin);
    }
  }, [shouldVirtualize, records.length, columnTemplate, getScrollElement]);
  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement,
    estimateSize: () => 48,
    overscan: 12,
    scrollMargin: listScrollMargin,
  });

  return (
    <div ref={tableRootRef}>
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <nav
          aria-label={messages.recordView.view}
          className="flex h-8 min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-testid="base-view-tabs"
        >
          {base ? (
            <Link
              className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-medium text-xs transition-colors ${
                activeView
                  ? "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  : "border-border/60 bg-muted/70 text-foreground"
              }`}
              href={mergeSearchIntoHref(`/base/${base.slug}`, currentSearch)}
            >
              {messages.base.all}
            </Link>
          ) : null}
          {views.map((view) => {
            const active = view.id === activeView?.id;
            return (
              <Link
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-medium text-xs transition-colors ${
                  active
                    ? "border-border/60 bg-muted/70 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
                href={mergeSearchIntoHref(`/base/${base?.slug ?? ""}/${view.slug}`, currentSearch)}
                key={view.id}
              >
                <ViewTypeIcon type={view.type} />
                {view.name}
              </Link>
            );
          })}
        </nav>
        {base ? (
          <button
            aria-label={messages.base.newView}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 border-dashed text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            data-testid="base-new-view-button"
            onClick={() => setEditingViewMode("create")}
            title={messages.base.newView}
            type="button"
          >
            <Plus size={13} />
          </button>
        ) : null}
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {(() => {
              // With a view filter active, records.length is the filtered rows
              // shown; without one, show the true whole-base total (so the header
              // reports "240 records", not the page size) once the count loads.
              const hasFilter = Boolean(activeView && activeView.config.filters.length > 0);
              const displayCount =
                !hasFilter && pagination?.total != null ? pagination.total : records.length;
              return fmt(messages.base.recordCount, {
                count: displayCount,
                plural: displayCount === 1 ? "" : "s",
              });
            })()}
            {archivedRecords.length > 0 ? (
              <button
                className="ml-2 underline-offset-2 hover:underline"
                onClick={() => setShowArchivedRecords((v) => !v)}
                type="button"
              >
                {showArchivedRecords
                  ? messages.base.hideArchived
                  : fmt(messages.base.archivedCount, { count: archivedRecords.length })}
              </button>
            ) : null}
          </span>
          {activeView ? (
            <details className="relative">
              <summary
                aria-label={messages.base.viewActions}
                className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&::-webkit-details-marker]:hidden"
                data-testid="active-view-actions"
                title={messages.base.viewActions}
              >
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
                  {messages.base.editView}
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
                  {isDeletingView ? messages.common.deleting : messages.base.deleteView}
                </button>
              </div>
            </details>
          ) : null}
          {base ? (
            <Link
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 font-medium text-background text-xs transition-colors hover:bg-foreground/85"
              href={mergeSearchIntoHref(`/base/${base.slug}/new`, currentSearch)}
            >
              <Plus size={13} />
              {messages.base.newRecord}
            </Link>
          ) : null}
        </div>
      </div>
      {activeView ? (
        <ViewConfigToolbar
          config={activeView.config}
          fields={allFields}
          onOpen={(section) => setViewEditorRequest({ section, source: "toolbar" })}
        />
      ) : base ? (
        <div
          className="mb-3 flex min-w-0 items-center gap-2 border-border/60 border-y py-2"
          data-testid="view-control-toolbar-readonly"
        >
          <Columns3 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-muted-foreground text-xs">
            {messages.base.savedViewToolbarRequired}
          </span>
        </div>
      ) : null}
      <ViewConfigEditorDialog
        fields={allFields}
        onClose={() => setViewEditorRequest(null)}
        onSubmit={submitViewControls}
        request={viewEditorRequest}
        view={activeView}
      />
      {base && editingViewMode ? (
        <ViewChangeRequestDialog
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
            ? fmt(messages.base.deleteViewRequestBody, { name: confirmDeleteView.name })
            : ""
        }
        confirmLabel={messages.base.createDeleteRequestLabel}
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
              setViewActionError(error instanceof Error ? error.message : messages.base.deleteView);
            })
            .finally(() => setIsDeletingView(false));
        }}
        open={confirmDeleteView !== null}
        pending={isDeletingView}
        title={messages.base.createDeleteRequestTitle}
      />
      {archivedViews.length > 0 ? (
        <details className="mb-3 rounded-md border border-border/50 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3 transition-transform details-open:rotate-90" />
            {fmt(messages.base.archivedViewsCount, {
              count: archivedViews.length,
              plural: archivedViews.length === 1 ? "" : "s",
            })}
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
                    {restoringViewId === view.id
                      ? messages.common.restoring
                      : messages.common.restore}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {activeView?.type === "gallery" ? (
        <BusaBaseGallery
          activeView={activeView}
          archivedRecords={archivedRecords}
          base={base}
          fields={fields}
          onRestoreRecord={onRestoreRecord}
          records={records}
          showArchivedRecords={showArchivedRecords}
        />
      ) : activeView?.type === "kanban" ? (
        <BusaBaseKanban
          activeView={activeView}
          base={base}
          fields={fields}
          onMoveRecord={onMoveRecord}
          records={records}
        />
      ) : activeView?.type === "calendar" ? (
        <BusaBaseCalendar activeView={activeView} base={base} fields={fields} records={records} />
      ) : activeView?.type === "gantt" ? (
        <BusaBaseGantt
          activeView={activeView}
          base={base}
          fields={fields}
          onPatchRecord={onPatchRecord}
          records={records}
        />
      ) : (
        <div className="overflow-x-auto pb-5">
          <div
            aria-colcount={fields.length + 1}
            aria-rowcount={1 + records.length + (showArchivedRecords ? archivedRecords.length : 0)}
            className="w-max min-w-full border-border/50 border-l border-t"
            data-testid="base-records-grid"
            role="grid"
          >
            <div
              aria-rowindex={1}
              className="grid h-9 items-stretch border-border/50 border-b bg-muted/45 text-muted-foreground text-xs"
              role="row"
              style={{ gridTemplateColumns: columnTemplate }}
              tabIndex={-1}
            >
              {fields.map((field, index) => (
                <FieldColumnHeader
                  actionsDisabled={quickUpdatingFieldId !== null}
                  activeView={activeView}
                  allFields={allFields}
                  baseSlug={base?.slug ?? records[0]?.base.slug ?? ""}
                  busy={quickUpdatingFieldId === field.id}
                  field={field}
                  canMoveLeft={index > 0}
                  canMoveRight={index < fields.length - 1}
                  customWidth={
                    columnWidthDrafts[field.slug] ?? activeView?.config.fieldWidths?.[field.slug]
                  }
                  dragOver={dropTarget?.slug === field.slug}
                  dragging={draggingFieldSlug === field.slug}
                  key={field.id}
                  name={resolveIString(field.name)}
                  onDragEnd={() => {
                    setDraggingFieldSlug(null);
                    setDropTarget(null);
                  }}
                  onDragLeave={() => {
                    if (dropTarget?.slug === field.slug) {
                      setDropTarget(null);
                    }
                  }}
                  onDragOver={(placement) => {
                    if (draggingFieldSlug && draggingFieldSlug !== field.slug) {
                      setDropTarget({ placement, slug: field.slug });
                    }
                  }}
                  onDragStart={() => {
                    setDraggingFieldSlug(field.slug);
                    setDropTarget(null);
                  }}
                  onDrop={(draggedSlug, placement) => {
                    const sourceSlug = draggedSlug || draggingFieldSlug;
                    setDraggingFieldSlug(null);
                    setDropTarget(null);
                    if (!activeView || !sourceSlug || sourceSlug === field.slug) {
                      return;
                    }
                    setQuickUpdatingFieldId(
                      allFields.find((item) => item.slug === sourceSlug)?.id ?? sourceSlug,
                    );
                    void quickUpdateView(
                      moveViewField(
                        activeView.config,
                        allFields,
                        sourceSlug,
                        field.slug,
                        placement,
                      ),
                    );
                  }}
                  onCreateView={() => setEditingViewMode("create")}
                  onMove={(direction) => {
                    if (!activeView) {
                      return;
                    }
                    const target = fields[index + (direction === "left" ? -1 : 1)];
                    if (!target) {
                      return;
                    }
                    setQuickUpdatingFieldId(field.id);
                    void quickUpdateView(
                      moveViewField(
                        activeView.config,
                        allFields,
                        field.slug,
                        target.slug,
                        direction === "left" ? "before" : "after",
                      ),
                    );
                  }}
                  onOpenViewEditor={(section, focusedFieldId) =>
                    setViewEditorRequest({ focusedFieldId, section, source: "header" })
                  }
                  onQuickUpdate={async (config) => {
                    setQuickUpdatingFieldId(field.id);
                    return quickUpdateView(config);
                  }}
                  onResizeCancel={() =>
                    setColumnWidthDrafts((current) => {
                      const next = { ...current };
                      delete next[field.slug];
                      return next;
                    })
                  }
                  onResizeCommit={(width) => {
                    if (!activeView) {
                      return;
                    }
                    setQuickUpdatingFieldId(field.id);
                    void quickUpdateView(
                      setViewFieldWidth(activeView.config, field.slug, width),
                    ).then((success) => {
                      if (!success) {
                        setColumnWidthDrafts((current) => {
                          const next = { ...current };
                          delete next[field.slug];
                          return next;
                        });
                      }
                    });
                  }}
                  onResizePreview={(width) =>
                    setColumnWidthDrafts((current) => ({ ...current, [field.slug]: width }))
                  }
                  sticky={index === 0}
                />
              ))}
              <div
                aria-label={messages.base.recordStatus}
                className={baseTableStatusHeaderClassName}
                role="columnheader"
                tabIndex={-1}
              >
                {messages.base.recordStatus}
              </div>
            </div>
            {pagination?.isLoading ? (
              <BusaBaseTableRowsSkeleton columnTemplate={columnTemplate} />
            ) : records.length === 0 ? (
              <div role="rowgroup">
                <div
                  aria-rowindex={2}
                  className="grid min-h-11 border-border/40 border-b"
                  role="row"
                  style={{ gridTemplateColumns: columnTemplate }}
                  tabIndex={-1}
                >
                  <div
                    aria-colspan={fields.length + 1}
                    className="flex items-center px-2 text-muted-foreground text-sm"
                    role="gridcell"
                    style={{ gridColumn: `span ${fields.length + 1}` }}
                    tabIndex={-1}
                  >
                    {messages.base.emptyRecords}
                  </div>
                </div>
              </div>
            ) : shouldVirtualize ? (
              <div
                ref={listRef}
                className="relative"
                role="rowgroup"
                style={{ height: rowVirtualizer.getTotalSize() }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const record = records[virtualRow.index];
                  return (
                    <BusaBaseRecordRow
                      baseSlug={base?.slug}
                      columnTemplate={columnTemplate}
                      fields={fields}
                      key={record.id}
                      record={record}
                      relationRecords={relationRecords}
                      rowIndex={virtualRow.index + 2}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              records.map((record, index) => (
                <BusaBaseRecordRow
                  baseSlug={base?.slug}
                  columnTemplate={columnTemplate}
                  fields={fields}
                  key={record.id}
                  record={record}
                  relationRecords={relationRecords}
                  rowIndex={index + 2}
                />
              ))
            )}
            {showArchivedRecords && archivedRecords.length > 0
              ? archivedRecords.map((record, archivedIndex) => (
                  <div
                    aria-rowindex={records.length + archivedIndex + 2}
                    className="group grid h-12 items-stretch border-border/40 border-b bg-muted/10 text-sm opacity-60 transition-colors hover:opacity-100"
                    key={record.id}
                    role="row"
                    style={{ gridTemplateColumns: columnTemplate }}
                    tabIndex={-1}
                  >
                    {fields.map((field, index) => (
                      <RecordTableCell
                        currentRecordHref={mergeSearchIntoHref(
                          `/base/${base?.slug ?? record.base.slug}/${record.id}`,
                          currentSearch,
                        )}
                        field={field}
                        index={index}
                        key={field.id}
                        record={record}
                        records={relationRecords}
                      />
                    ))}
                    <div className={baseTableStatusCellClassName} role="gridcell" tabIndex={-1}>
                      <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full bg-muted/55 px-2 py-0.5 text-muted-foreground text-xs">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-55" />
                        <span className="truncate">{messages.common.archived}</span>
                      </span>
                      {onRestoreRecord ? (
                        <button
                          aria-label={messages.common.restore}
                          className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded border border-border/60 bg-background transition-colors hover:bg-accent disabled:opacity-50"
                          disabled={restoringRecordId === record.id}
                          onClick={() => {
                            setRestoringRecordId(record.id);
                            onRestoreRecord(record).finally(() => setRestoringRecordId(null));
                          }}
                          type="button"
                          title={messages.common.restore}
                        >
                          <RotateCcw className="size-3" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              : null}
            {showArchivedRecords && archivedPagination?.hasMore ? (
              <div className="flex items-center justify-center pt-2">
                <button
                  className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
                  disabled={archivedPagination.isLoadingMore}
                  onClick={() => archivedPagination.loadMore()}
                  type="button"
                >
                  {archivedPagination.isLoadingMore
                    ? messages.common.loading
                    : messages.search.loadMore}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
      {pagination?.hasMore ? (
        <div className="flex items-center justify-center pt-3">
          <button
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border/70 px-3 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
            disabled={pagination.isLoadingMore}
            onClick={() => pagination.loadMore()}
            type="button"
          >
            {pagination.isLoadingMore ? messages.common.loading : messages.search.loadMore}
            {pagination.total != null ? (
              <span className="text-muted-foreground/70">
                {pagination.loaded} / {pagination.total}
              </span>
            ) : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface ViewChangeRequestFormProps {
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
}

function ViewChangeRequestDialog(props: ViewChangeRequestFormProps) {
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          props.onCancel();
        }
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85vh] w-[calc(100%-2rem)] overflow-y-auto p-0 sm:max-w-4xl"
        showCloseButton={false}
      >
        <ViewChangeRequestForm {...props} />
      </DialogContent>
    </Dialog>
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
}: ViewChangeRequestFormProps) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const attachmentFields = base.fields.filter((field) => field.type === "attachment");
  const selectFields = base.fields.filter((field) => field.type === "select");
  const dateFields = base.fields.filter(
    (field) =>
      field.type === "date" || field.type === "created_time" || field.type === "updated_time",
  );
  const [name, setName] = useState(view?.name ?? "");
  const [slug, setSlug] = useState(view?.slug ?? "");
  const [description, setDescription] = useState(view?.description ?? "");
  const [viewConfigDraft, setViewConfigDraft] = useState<ViewConfigVO>(
    view?.config ?? { filters: [], sorts: [] },
  );
  const [viewType, setViewType] = useState<ViewType>(view?.type ?? "table");
  // "" means auto (first attachment field); "__none__" means explicitly no cover.
  const [coverFieldSlug, setCoverFieldSlug] = useState<string>(
    view?.config.coverFieldSlug === null ? "__none__" : (view?.config.coverFieldSlug ?? ""),
  );
  const [coverFit, setCoverFit] = useState<GalleryCoverFit>(view?.config.coverFit ?? "cover");
  const [cardSize, setCardSize] = useState<GalleryCardSize>(view?.config.cardSize ?? "medium");
  const [showFieldLabels, setShowFieldLabels] = useState<boolean>(
    view?.config.showFieldLabels ?? false,
  );
  // "" means auto (first field of the right type).
  const [stackByFieldSlug, setStackByFieldSlug] = useState<string>(
    view?.config.stackByFieldSlug ?? "",
  );
  const [dateFieldSlug, setDateFieldSlug] = useState<string>(view?.config.dateFieldSlug ?? "");
  const [startFieldSlug, setStartFieldSlug] = useState<string>(view?.config.startFieldSlug ?? "");
  const [endFieldSlug, setEndFieldSlug] = useState<string>(view?.config.endFieldSlug ?? "");
  const [ganttScale, setGanttScale] = useState<GanttScale>(view?.config.ganttScale ?? "month");
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (mode === "edit" && !view) {
    return null;
  }

  const submit = async (options?: ViewSubmitOptions) => {
    const trimmedName = name.trim();
    const trimmedSlug = toSlug(slug);
    if (!trimmedName) {
      setFormError(messages.base.viewNameRequired);
      return;
    }
    if (mode === "create" && !trimmedSlug) {
      setFormError(messages.base.viewSlugRequired);
      return;
    }
    const nextConfig: ViewConfigVO = {
      ...viewConfigDraft,
      // Gallery presentation config — only meaningful for gallery views.
      ...(viewType === "gallery"
        ? {
            coverFieldSlug:
              coverFieldSlug === "__none__"
                ? null
                : coverFieldSlug === ""
                  ? undefined
                  : coverFieldSlug,
            coverFit,
            cardSize,
            showFieldLabels,
          }
        : {}),
      // Kanban / calendar config — "" means auto-pick the first field of the type.
      ...(viewType === "kanban"
        ? { stackByFieldSlug: stackByFieldSlug === "" ? undefined : stackByFieldSlug }
        : {}),
      ...(viewType === "calendar"
        ? { dateFieldSlug: dateFieldSlug === "" ? undefined : dateFieldSlug }
        : {}),
      ...(viewType === "gantt"
        ? {
            startFieldSlug: startFieldSlug === "" ? undefined : startFieldSlug,
            endFieldSlug: endFieldSlug === "" ? undefined : endFieldSlug,
            ganttScale,
          }
        : {}),
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
            type: viewType,
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
            type: viewType,
          },
          options,
        );
      }
      onSubmitted();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : messages.base.failedSubmitView);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DialogTitle>
          {mode === "create" ? messages.base.newViewTitle : messages.base.editViewTitle}
        </DialogTitle>
        <button
          aria-label={messages.base.closeViewForm}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onCancel}
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
        <label className="block">
          <span className="text-muted-foreground text-xs">{messages.common.name}</span>
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
          <span className="text-muted-foreground text-xs">{messages.common.slug}</span>
          <input
            className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 font-mono text-sm outline-none transition-colors focus:border-primary disabled:bg-muted/40 disabled:text-muted-foreground"
            disabled={mode === "edit"}
            onChange={(event) => setSlug(toSlugInput(event.target.value))}
            value={slug}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-muted-foreground text-xs">{messages.common.description}</span>
          <textarea
            className="mt-1 min-h-16 w-full resize-y rounded-md border border-border/70 bg-background px-2.5 py-2 text-sm outline-none transition-colors focus:border-primary"
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </label>
      </div>

      <div className="mt-3">
        <span className="text-muted-foreground text-xs">{messages.base.viewType}</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {(
            [
              {
                icon: <Table2 size={14} />,
                label: messages.base.viewTypeTable,
                value: "table",
              },
              {
                icon: <LayoutGrid size={14} />,
                label: messages.base.viewTypeGallery,
                value: "gallery",
              },
              {
                icon: <Columns3 size={14} />,
                label: messages.base.viewTypeKanban,
                value: "kanban",
              },
              {
                icon: <CalendarDays size={14} />,
                label: messages.base.viewTypeCalendar,
                value: "calendar",
              },
              {
                icon: <GanttChart size={14} />,
                label: messages.base.viewTypeGantt,
                value: "gantt",
              },
            ] as const
          ).map((option) => (
            <button
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium text-xs transition-colors ${
                viewType === option.value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/70 bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              key={option.value}
              onClick={() => setViewType(option.value)}
              type="button"
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {viewType === "gallery" ? (
        <div className="mt-3 grid gap-3 rounded-md border border-border/50 bg-muted/15 p-3 md:grid-cols-3">
          <label className="block">
            <span className="text-muted-foreground text-xs">{messages.base.coverField}</span>
            <select
              className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
              onChange={(event) => setCoverFieldSlug(event.target.value)}
              value={coverFieldSlug}
            >
              <option value="">{messages.base.coverFieldAuto}</option>
              {attachmentFields.map((field) => (
                <option key={field.id} value={field.slug}>
                  {resolveIString(field.name)}
                </option>
              ))}
              <option value="__none__">{messages.base.coverFieldNone}</option>
            </select>
          </label>
          <label className="block">
            <span className="text-muted-foreground text-xs">{messages.base.coverFit}</span>
            <select
              className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
              onChange={(event) => setCoverFit(event.target.value as GalleryCoverFit)}
              value={coverFit}
            >
              <option value="cover">{messages.base.coverFitCrop}</option>
              <option value="fit">{messages.base.coverFitFit}</option>
            </select>
          </label>
          <label className="block">
            <span className="text-muted-foreground text-xs">{messages.base.cardSize}</span>
            <select
              className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
              onChange={(event) => setCardSize(event.target.value as GalleryCardSize)}
              value={cardSize}
            >
              <option value="small">{messages.base.cardSizeSmall}</option>
              <option value="medium">{messages.base.cardSizeMedium}</option>
              <option value="large">{messages.base.cardSizeLarge}</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-muted-foreground text-sm md:col-span-3">
            <input
              checked={showFieldLabels}
              onChange={(event) => setShowFieldLabels(event.target.checked)}
              type="checkbox"
            />
            {messages.base.showFieldLabels}
          </label>
        </div>
      ) : null}

      {viewType === "kanban" ? (
        <div className="mt-3 rounded-md border border-border/50 bg-muted/15 p-3">
          <label className="block md:max-w-xs">
            <span className="text-muted-foreground text-xs">{messages.base.stackByField}</span>
            <select
              className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
              onChange={(event) => setStackByFieldSlug(event.target.value)}
              value={stackByFieldSlug}
            >
              <option value="">{messages.base.stackByFieldAuto}</option>
              {selectFields.map((field) => (
                <option key={field.id} value={field.slug}>
                  {resolveIString(field.name)}
                </option>
              ))}
            </select>
          </label>
          {selectFields.length === 0 ? (
            <div className="mt-2 text-amber-700 text-xs">{messages.base.kanbanNoSelect}</div>
          ) : null}
        </div>
      ) : null}

      {viewType === "calendar" ? (
        <div className="mt-3 rounded-md border border-border/50 bg-muted/15 p-3">
          <label className="block md:max-w-xs">
            <span className="text-muted-foreground text-xs">{messages.base.dateField}</span>
            <select
              className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
              onChange={(event) => setDateFieldSlug(event.target.value)}
              value={dateFieldSlug}
            >
              <option value="">{messages.base.dateFieldAuto}</option>
              {dateFields.map((field) => (
                <option key={field.id} value={field.slug}>
                  {resolveIString(field.name)}
                </option>
              ))}
            </select>
          </label>
          {dateFields.length === 0 ? (
            <div className="mt-2 text-amber-700 text-xs">{messages.base.calendarNoDate}</div>
          ) : null}
        </div>
      ) : null}

      {viewType === "gantt" ? (
        <div className="mt-3 grid gap-3 rounded-md border border-border/50 bg-muted/15 p-3 md:grid-cols-3">
          <label className="block">
            <span className="text-muted-foreground text-xs">{messages.base.ganttStartField}</span>
            <select
              className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
              onChange={(event) => setStartFieldSlug(event.target.value)}
              value={startFieldSlug}
            >
              <option value="">{messages.base.dateFieldAuto}</option>
              {dateFields.map((field) => (
                <option key={field.id} value={field.slug}>
                  {resolveIString(field.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-muted-foreground text-xs">{messages.base.ganttEndField}</span>
            <select
              className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
              onChange={(event) => setEndFieldSlug(event.target.value)}
              value={endFieldSlug}
            >
              <option value="">{messages.base.dateFieldAuto}</option>
              {dateFields.map((field) => (
                <option key={field.id} value={field.slug}>
                  {resolveIString(field.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-muted-foreground text-xs">{messages.base.ganttScale}</span>
            <select
              className="mt-1 h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary"
              onChange={(event) => setGanttScale(event.target.value as GanttScale)}
              value={ganttScale}
            >
              <option value="week">{messages.base.ganttWeek}</option>
              <option value="month">{messages.base.ganttMonth}</option>
            </select>
          </label>
          {dateFields.length < 2 ? (
            <div className="mt-1 text-amber-700 text-xs md:col-span-3">
              {messages.base.ganttNoDates}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 border border-border/60">
        <ViewFieldsEditor
          config={viewConfigDraft}
          fields={base.fields}
          onChange={setViewConfigDraft}
          testId={mode === "edit" ? "edit-view-shared-fields" : "new-view-shared-fields"}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-border/50 border-t pt-3">
        {formError ? <div className="text-red-700 text-sm">{formError}</div> : <div />}
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-border/70 bg-background px-3 py-1.5 font-medium text-xs transition-colors hover:bg-accent"
            onClick={onCancel}
            type="button"
          >
            {messages.common.cancel}
          </button>
          <SplitSubmitButton
            changeRequestAction={{
              label:
                mode === "create" ? messages.base.addViewRequest : messages.base.updateViewRequest,
              loadingLabel: messages.common.submitting,
              onSubmit: () => submit(),
              isLoading: isSaving,
            }}
            disabled={isSaving}
            hint={messages.common.mergeImmediatelyHint}
            immediateAction={{
              label: mode === "create" ? messages.base.addViewNow : messages.base.updateViewNow,
              loadingLabel: messages.recordView.merging,
              onSubmit: () => submit({ mergeImmediately: true }),
              isLoading: isSaving,
            }}
          />
        </div>
      </div>
    </div>
  );
}

interface RecordTableCellProps {
  currentRecordHref: string;
  field: BaseFieldVO;
  index: number;
  record: RecordVO;
  records: RecordVO[];
}

function RecordTableCell(props: RecordTableCellProps) {
  return (
    <div
      className={`flex min-w-0 items-center overflow-hidden border-border/40 border-r px-2 ${
        props.index === 0 ? baseTableStickyClassName : ""
      }`}
      role="gridcell"
      tabIndex={-1}
    >
      <RecordTableCellContent {...props} />
    </div>
  );
}

function RecordTableCellContent({
  currentRecordHref,
  field,
  index,
  record,
  records,
}: RecordTableCellProps) {
  const messages = useCoreI18n();
  const currentSearch = useSearch();
  const rawValue = record.headCommit.fields[field.slug];
  const chips = getFieldChipEntries(field, rawValue);
  const kind = fieldDisplayKind(field.type);

  if (kind === "checkbox") {
    const checked = rawValue === true || rawValue === "true";
    return (
      <Link
        className={`flex min-w-0 items-center py-1 ${index === 0 ? "" : "text-muted-foreground"}`}
        href={currentRecordHref}
        title={checked ? messages.common.yes : messages.common.no}
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
        className="flex min-w-0 flex-wrap gap-1.5 py-1"
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
        <div className="min-w-0 truncate py-1 text-muted-foreground text-sm" title="-">
          -
        </div>
      );
    }
    const tableImages = attachments.filter(
      (a) => a.mimeType?.startsWith("image/") && getSafeAttachmentUrl(a),
    );
    const tableOthers = attachments.filter(
      (a) => !a.mimeType?.startsWith("image/") || !getSafeAttachmentUrl(a),
    );
    return (
      <div
        className="flex min-w-0 flex-wrap items-center gap-1.5 py-1"
        title={attachments.map((item) => item.fileName).join(", ")}
      >
        {tableImages.slice(0, 3).map((item) => {
          const safeUrl = getSafeAttachmentUrl(item);
          return safeUrl ? (
            <img
              alt={item.fileName}
              className="h-8 w-auto max-w-[6rem] rounded border object-cover"
              key={item.id}
              src={safeUrl}
              title={item.fileName}
            />
          ) : null;
        })}
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
        <div className="min-w-0 truncate py-1 text-muted-foreground text-sm" title="-">
          -
        </div>
      );
    }

    return (
      <div className="flex min-w-0 flex-wrap gap-1.5 py-1">
        {relationIds.map((recordId) => {
          const linkedRecord = records.find((item) => item.id === recordId);
          const label = linkedRecord
            ? getRecordTitle(linkedRecord, messages)
            : shortIdentifier(recordId);
          const chipClassName = "max-w-full truncate rounded-full bg-muted/70 px-2 py-0.5 text-xs";
          return linkedRecord ? (
            <Link
              className={`${chipClassName} text-primary transition-colors hover:bg-primary/10 hover:underline`}
              href={mergeSearchIntoHref(
                `/base/${linkedRecord.base.slug}/${linkedRecord.id}`,
                currentSearch,
              )}
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

  if (["markdown", "code", "json", "yaml"].includes(field.type)) {
    const source = fieldValueToString(rawValue);
    const summary = source.replace(/\s+/g, " ").trim();
    if (!summary) {
      return (
        <Link
          className="flex min-w-0 items-center py-1 text-muted-foreground"
          href={currentRecordHref}
          title="-"
        >
          -
        </Link>
      );
    }
    return (
      <Link
        className={`block min-w-0 truncate py-1 underline-offset-2 hover:underline ${
          field.type === "markdown"
            ? "text-muted-foreground"
            : "font-mono text-muted-foreground text-xs"
        }`}
        href={currentRecordHref}
        title={source}
      >
        {summary}
      </Link>
    );
  }

  if (kind === "embed") {
    const preview = resolveEmbedPreview(rawValue, field);
    if (!preview) {
      return (
        <Link
          className="flex min-w-0 items-center py-1 text-muted-foreground"
          href={currentRecordHref}
          title="-"
        >
          -
        </Link>
      );
    }
    return (
      <Link
        className={`flex min-w-0 items-center gap-2 py-1 ${
          index === 0 ? "font-medium text-foreground" : "text-muted-foreground"
        }`}
        href={currentRecordHref}
        title={preview.sourceUrl}
      >
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-muted/35 text-muted-foreground">
          <PlaySquare size={14} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground text-xs">
            {preview.label}
          </span>
          <span className="block truncate text-muted-foreground text-[11px]">
            {preview.hostname}
          </span>
        </span>
        <ExternalLink className="ml-auto shrink-0 text-muted-foreground" size={12} />
      </Link>
    );
  }

  const value = getFieldPreviewText(field, rawValue, messages);

  return (
    <Link
      className={`flex min-w-0 items-center gap-2 py-1 underline-offset-2 hover:underline ${
        index === 0 ? "font-medium text-foreground" : "text-muted-foreground"
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
