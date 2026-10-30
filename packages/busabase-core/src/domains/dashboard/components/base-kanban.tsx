import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type {
  BaseFieldVO,
  BaseVO,
  GalleryCoverFit,
  RecordVO,
  ViewVO,
} from "busabase-contract/types";
import { ImageOff } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type MouseEvent, type ReactNode, useRef, useState } from "react";
import { useSearch } from "wouter";
import { useCoreI18n, useCoreLocale, useIString } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { getMemberIds, isPeopleFieldType } from "../../base/field-types";
import { getPrimaryField } from "../../base/utils/primary-field";
import { getRecordTitle } from "../helpers/change-request";
import {
  getAttachmentRefs,
  getFieldChipEntries,
  getFieldPreviewText,
  getRelationRecordIds,
  getSafeAttachmentUrl,
} from "../helpers/field";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { useLinkedRecords } from "../hooks/use-linked-records";
import { useDashboardOrpc } from "../orpc-context";
import { useIsAnonymousVisitor } from "../visitor-context";
import { AttachmentValuePreview } from "./attachment-value-preview";
import { FieldBadgeList, FieldValuePreview, LookupFieldValue } from "./field-preview";
import { MemberChips } from "./member-field";
import { useWorkspacePermissionLevel } from "./split-submit-button";

/**
 * Kanban drag-to-move. Resolves with whether the move landed: a viewer whose
 * level on the Base is only `changeRequest` gets a pending change request back
 * instead (the server does not auto-merge for them).
 */
export type KanbanMoveRecord = (
  record: RecordVO,
  fieldSlug: string,
  value: string | null,
) => Promise<{ materialized: true } | { materialized: false; changeRequestId: string }>;

type Choice = { id: string; name: string; color?: string };

// Tailwind-safe swatch classes per choice color (mirrors the select chip palette).
const COLOR_DOT: Record<string, string> = {
  slate: "bg-slate-400",
  violet: "bg-violet-400",
  cyan: "bg-cyan-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  orange: "bg-orange-400",
};

const UNCATEGORIZED = "__uncategorized__";

function KanbanCardField({
  children,
  field,
  showFieldLabels,
}: {
  children: ReactNode;
  field: BaseFieldVO;
  showFieldLabels: boolean;
}) {
  const resolveIString = useIString();
  return (
    <div className="mt-1.5 min-w-0 text-xs">
      <dt
        className={showFieldLabels ? "mb-0.5 truncate text-muted-foreground" : "sr-only"}
        title={resolveIString(field.name)}
      >
        {resolveIString(field.name)}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Resolve which single-select field stacks the board into columns. Honors the
 * view's `stackByFieldSlug`; otherwise falls back to the first select field on
 * the base (the sensible default so a fresh kanban has columns without config).
 */
export const resolveStackByField = (
  base: BaseVO | null,
  fields: BaseFieldVO[],
  stackByFieldSlug: string | null | undefined,
): BaseFieldVO | null => {
  const selectFields = (base?.fields ?? fields).filter((f) => f.type === "select");
  if (stackByFieldSlug) {
    return selectFields.find((f) => f.slug === stackByFieldSlug) ?? null;
  }
  return selectFields[0] ?? null;
};

function KanbanCover({
  fit,
  href,
  onClick,
  value,
}: {
  fit: GalleryCoverFit;
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  value: unknown;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const image = getAttachmentRefs(value).find(
    (item) => item.mimeType?.startsWith("image/") && getSafeAttachmentUrl(item),
  );
  const url = image ? getSafeAttachmentUrl(image) : null;
  if (!url || !image) return null;

  return (
    <Link
      className="mb-2 block aspect-[3/2] overflow-hidden rounded bg-muted/30"
      data-kanban-cover
      data-testid="kanban-cover"
      href={href}
      onClick={onClick}
      title={image.fileName}
    >
      {failedUrl === url ? (
        <span className="flex h-full flex-col items-center justify-center gap-2 px-3 text-muted-foreground text-xs">
          <ImageOff aria-hidden size={20} />
          <span className="max-w-full truncate">{image.fileName}</span>
        </span>
      ) : (
        <img
          alt={image.fileName}
          className={`h-full w-full ${fit === "fit" ? "object-contain" : "object-cover"}`}
          decoding="async"
          draggable={false}
          loading="lazy"
          onError={() => setFailedUrl(url)}
          src={url}
        />
      )}
    </Link>
  );
}

function KanbanCard({
  record,
  fields,
  stackFieldSlug,
  baseSlug,
  draggable,
  onDragStart,
  onOpenRecord,
  relationRecords,
  showFieldLabels,
  coverField,
  coverFit,
}: {
  record: RecordVO;
  fields: BaseFieldVO[];
  stackFieldSlug: string | undefined;
  baseSlug: string;
  draggable: boolean;
  onDragStart: () => void;
  onOpenRecord?: (record: RecordVO) => void;
  relationRecords: RecordVO[];
  showFieldLabels: boolean;
  coverField: BaseFieldVO | null;
  coverFit: GalleryCoverFit;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const resolveIString = useIString();
  const currentSearch = useSearch();
  const suppressDragClick = useRef(false);
  const title = getRecordTitle(record, messages);
  const primaryFieldSlug = getPrimaryField(record.base)?.slug;
  const bodyFields = fields.filter(
    (field) => field.slug !== primaryFieldSlug && field.slug !== stackFieldSlug,
  );
  const openRecord = (event: MouseEvent<HTMLElement>) => {
    if (
      !onOpenRecord ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.currentTarget instanceof HTMLAnchorElement &&
        event.currentTarget.target !== "" &&
        event.currentTarget.target !== "_self")
    ) {
      return;
    }
    event.preventDefault();
    onOpenRecord(record);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: kanban card is a native HTML5 drag source; the title Link remains the keyboard-accessible affordance
    <div
      className={`rounded-md border border-border/60 bg-background p-2.5 shadow-sm transition-shadow hover:shadow-md ${
        draggable ? "cursor-grab active:cursor-grabbing" : onOpenRecord ? "cursor-pointer" : ""
      }`}
      data-record-id={record.id}
      draggable={draggable}
      onPointerDownCapture={() => {
        suppressDragClick.current = false;
      }}
      onKeyDownCapture={() => {
        suppressDragClick.current = false;
      }}
      onClickCapture={(event) => {
        if (event.currentTarget.contains(event.target as Node) && suppressDragClick.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onClick={(event) => {
        // React portal events bubble through the card even when the dialog is
        // mounted elsewhere. Field controls keep their own actions as well.
        if (
          !event.currentTarget.contains(event.target as Node) ||
          (event.target instanceof Element &&
            event.target.closest(
              "a, button, input, select, textarea, [role='button'], [role='link'], [role='dialog'], [contenteditable='true']",
            ))
        ) {
          return;
        }
        openRecord(event);
      }}
      onDragStart={
        draggable
          ? (event) => {
              // Interactive field content must not start moving the whole card.
              const control =
                event.target instanceof Element
                  ? event.target.closest("button, a, input, [role='dialog']")
                  : null;
              if (control && !control.matches("[data-kanban-record-title]")) {
                event.preventDefault();
                return;
              }
              suppressDragClick.current = true;
              onDragStart();
            }
          : undefined
      }
    >
      {coverField ? (
        <KanbanCover
          fit={coverFit}
          href={mergeSearchIntoHref(`/base/${baseSlug}/${record.id}`, currentSearch)}
          onClick={openRecord}
          value={record.headCommit.payload[coverField.slug]}
        />
      ) : null}
      <Link
        className="block truncate font-medium text-foreground text-sm hover:underline"
        data-kanban-record-title
        href={mergeSearchIntoHref(`/base/${baseSlug}/${record.id}`, currentSearch)}
        onClick={openRecord}
        title={title}
      >
        {title}
      </Link>
      <dl>
        {bodyFields.map((field) => {
          const rawValue = record.headCommit.payload[field.slug];
          if (field.type === "attachment") {
            return getAttachmentRefs(rawValue).length === 0 ? null : (
              <KanbanCardField field={field} key={field.id} showFieldLabels={showFieldLabels}>
                <AttachmentValuePreview compact value={rawValue} />
              </KanbanCardField>
            );
          }
          if (field.type === "select" || field.type === "multiselect") {
            const chips = getFieldChipEntries(field, rawValue);
            return chips.length === 0 ? null : (
              <KanbanCardField field={field} key={field.id} showFieldLabels={showFieldLabels}>
                <FieldBadgeList chips={chips} />
              </KanbanCardField>
            );
          }
          if (field.type === "relation") {
            return getRelationRecordIds(rawValue).length === 0 ? null : (
              <KanbanCardField field={field} key={field.id} showFieldLabels={showFieldLabels}>
                <FieldValuePreview field={field} records={relationRecords} value={rawValue} />
              </KanbanCardField>
            );
          }
          if (field.type === "lookup") {
            return (
              <KanbanCardField field={field} key={field.id} showFieldLabels={showFieldLabels}>
                <LookupFieldValue
                  computed={record.computedFields?.[field.slug]}
                  field={field}
                  fieldUsers={record.fieldUsers}
                  value={rawValue}
                />
              </KanbanCardField>
            );
          }
          // A card is scanned, not read — the whole point of a board is
          // recognising an owner at a glance, which a joined list of user ids does
          // not do. People render as avatar chips here, not as preview text.
          if (isPeopleFieldType(field.type)) {
            const memberIds = getMemberIds(rawValue);
            return memberIds.length === 0 ? null : (
              <KanbanCardField field={field} key={field.id} showFieldLabels={showFieldLabels}>
                <div className="flex min-w-0">
                  <MemberChips users={record.fieldUsers} value={rawValue} />
                </div>
              </KanbanCardField>
            );
          }
          const preview = getFieldPreviewText(field, rawValue, messages, locale);
          if (!preview || preview === "-") {
            return null;
          }
          return (
            <KanbanCardField field={field} key={field.id} showFieldLabels={showFieldLabels}>
              <div
                className="truncate text-muted-foreground"
                title={`${resolveIString(field.name)}: ${preview}`}
              >
                {preview}
              </div>
            </KanbanCardField>
          );
        })}
      </dl>
    </div>
  );
}

/** Cards per request inside one column. Smaller than a table page: a column is
 *  a narrow strip, so ~20 already overflows a tall screen. */
const COLUMN_PAGE_SIZE = 20;

/**
 * One board column, paged on its own. This is the whole point of the board's
 * data model: a column asks only for the cards it shows, so opening a board no
 * longer depends on how many records the Base has in total.
 *
 * KNOWN DIVERGENCE (deliberate, pinned by tests): the column filter uses
 * `is_empty` for Uncategorized, which asks "does this render as empty?", while
 * the board's own bucketing rule is "is this value one of the field's choices?".
 * They agree for every value written through field validation. They differ for a
 * value that bypassed it (a seed can) — such a record buckets as Uncategorized
 * here but is not matched by `is_empty`, so its card would be missing. Catching
 * that would need a "value is not one of these" operator, which does not exist
 * and is not worth adding for data the product does not let you create.
 */
function KanbanColumn({
  base,
  canDrag,
  client,
  column,
  count,
  fields,
  isOver,
  onDragOverColumn,
  onDrop,
  onDragStartRecord,
  onOpenRecord,
  stackField,
  showFieldLabels,
  coverField,
  coverFit,
  viewId,
}: {
  base: BaseVO | null;
  canDrag: boolean;
  client: BusabaseDashboardApiClient;
  column: { id: string; name: string; color?: string };
  count: number | undefined;
  fields: BaseFieldVO[];
  isOver: boolean;
  onDragOverColumn: () => void;
  onDrop: () => void;
  onDragStartRecord: (record: RecordVO) => void;
  onOpenRecord?: (record: RecordVO) => void;
  stackField: BaseFieldVO;
  showFieldLabels: boolean;
  coverField: BaseFieldVO | null;
  coverFit: GalleryCoverFit;
  viewId: string | undefined;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const baseId = base?.id ?? "";
  const orpc = useDashboardOrpc();

  const cardsQuery = useInfiniteQuery({
    enabled: Boolean(baseId),
    getNextPageParam: (last: { page: number; totalPages: number }) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.listRecordsPage({
        baseId,
        filters: [
          column.id === UNCATEGORIZED
            ? { fieldSlug: stackField.slug, fieldType: "select", operator: "is_empty" as const }
            : {
                fieldSlug: stackField.slug,
                fieldType: "select",
                operator: "equals" as const,
                value: column.id,
              },
        ],
        page: pageParam as number,
        pageSize: COLUMN_PAGE_SIZE,
        ...(viewId ? { viewId } : {}),
      }),
    // The shared live-sync invalidates this workspace's canonical record prefix
    // on source/ACL changes. A custom top-level key misses those refreshes.
    queryKey: [
      ...(orpc?.records.listPage.key() ?? ["busabase"]),
      "kanban-column",
      baseId,
      viewId ?? "",
      stackField.slug,
      column.id,
    ],
  });

  const records = (cardsQuery.data?.pages ?? []).flatMap((page) => page.records);
  const primaryFieldSlug = getPrimaryField(base ?? records[0]?.base)?.slug;
  const relationFields = fields.filter(
    (field) => field.type === "relation" && field.slug !== primaryFieldSlug,
  );
  const relationIds = [
    ...new Set(
      records.flatMap((record) =>
        relationFields.flatMap((field) =>
          getRelationRecordIds(record.headCommit.payload[field.slug]),
        ),
      ),
    ),
  ];
  // One `records.getMany` per 100 linked ids for the whole column, rather than
  // one `records.get` each. A failed chunk contributes nothing: React Query
  // keeps the previous value on a failed refetch, and a cached title must never
  // render after access was revoked or the linked record removed.
  const { records: relationRecords } = useLinkedRecords({ client, ids: relationIds, orpc });
  const baseSlug = base?.slug ?? records[0]?.base.slug ?? "";
  // The header count comes from the aggregate, not from what is loaded — a
  // number that climbs while you scroll is worse than no number.
  const total = count ?? cardsQuery.data?.pages[0]?.total;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: kanban column is a native HTML5 drop target; each card's Link is the keyboard-accessible path
    <div
      className={`flex max-h-[70vh] w-64 shrink-0 flex-col rounded-lg border bg-muted/15 transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-border/50"
      }`}
      data-testid={`kanban-column-${column.id}`}
      onDragOver={
        canDrag
          ? (event) => {
              event.preventDefault();
              onDragOverColumn();
            }
          : undefined
      }
      onDrop={canDrag ? onDrop : undefined}
    >
      <div className="flex items-center gap-2 border-border/40 border-b px-3 py-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${COLOR_DOT[column.color ?? "slate"] ?? COLOR_DOT.slate}`}
        />
        <span className="truncate font-medium text-foreground text-sm">{column.name}</span>
        <span className="ml-auto rounded-md bg-muted/60 px-1.5 text-muted-foreground text-xs">
          {total ?? "…"}
        </span>
      </div>
      {/* The column scrolls on its own, which is what gives "load more" a place
          to live; before this the column grew with its content and the whole
          board scrolled as one. */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {cardsQuery.isPending ? (
          <div className="px-1 py-4 text-center text-muted-foreground/70 text-xs">
            {messages.common.loading}
          </div>
        ) : records.length === 0 ? (
          <div className="px-1 py-4 text-center text-muted-foreground/70 text-xs">
            {resolveIString(stackField.name)}
          </div>
        ) : (
          records.map((record) => (
            <KanbanCard
              baseSlug={baseSlug}
              coverField={coverField}
              coverFit={coverFit}
              draggable={canDrag}
              fields={fields}
              key={record.id}
              onDragStart={() => onDragStartRecord(record)}
              onOpenRecord={onOpenRecord}
              record={record}
              relationRecords={relationRecords}
              showFieldLabels={showFieldLabels}
              stackFieldSlug={stackField.slug}
            />
          ))
        )}
        {cardsQuery.hasNextPage ? (
          <button
            className="rounded-md border border-border/50 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted/40"
            disabled={cardsQuery.isFetchingNextPage}
            onClick={() => void cardsQuery.fetchNextPage()}
            type="button"
          >
            {cardsQuery.isFetchingNextPage ? messages.common.loading : messages.search.loadMore}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Kanban view — stacks records into columns by a single-select field. Each
 * column fetches its own cards and its header count comes from a server-side
 * aggregate, so opening a board costs a few small requests rather than reading
 * the entire Base into the browser.
 *
 * Dragging a card to another column writes the new choice back through
 * `onMoveRecord` (which, per busabase's approval model, opens an auto-merged
 * ChangeRequest — an instant change that still leaves an audit trail).
 * Read-only when no move handler is provided, or when the viewer's level on the
 * Base (see `SubmitPermissionProvider`) is below `changeRequest`.
 */
export function BusaBaseKanban({
  activeView,
  base,
  client,
  fields,
  onMoveRecord,
  onOpenRecord,
}: {
  activeView: ViewVO | null;
  base: BaseVO | null;
  client: BusabaseDashboardApiClient;
  fields: BaseFieldVO[];
  onMoveRecord?: KanbanMoveRecord;
  onOpenRecord?: (record: RecordVO) => void;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const currentSearch = useSearch();
  const isAnon = useIsAnonymousVisitor();
  const permissionLevel = useWorkspacePermissionLevel();
  const [moveError, setMoveError] = useState<string | null>(null);
  const [reviewRequestId, setReviewRequestId] = useState<string | null>(null);
  // The dragged RECORD, not just its id: the board no longer holds an array of
  // every record to look one up in.
  const [dragging, setDragging] = useState<RecordVO | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const stackField = resolveStackByField(base, fields, activeView?.config.stackByFieldSlug);
  // Covers are opt-in on boards: missing legacy config must not make every
  // existing card taller merely because it contains an attachment.
  const coverField = activeView?.config.coverFieldSlug
    ? ((base?.fields ?? fields).find(
        (field) => field.type === "attachment" && field.slug === activeView.config.coverFieldSlug,
      ) ?? null)
    : null;
  const baseId = base?.id ?? "";
  const orpc = useDashboardOrpc();

  const countsQuery = useQuery({
    enabled: Boolean(baseId) && Boolean(stackField),
    queryFn: () =>
      client.groupRecords({
        baseId,
        fieldSlug: stackField?.slug ?? "",
        ...(activeView?.id ? { viewId: activeView.id } : {}),
      }),
    queryKey: [
      ...(orpc?.records.count.key() ?? ["busabase"]),
      "kanban-counts",
      baseId,
      activeView?.id ?? "",
      stackField?.slug ?? "",
    ],
  });

  if (!stackField) {
    return (
      <div className="px-2 py-6 text-muted-foreground text-sm">{messages.base.kanbanNoSelect}</div>
    );
  }

  const choices = (stackField.options.choices ?? []) as Choice[];
  const columns: Array<{ id: string; name: string; color?: string }> = [
    ...choices.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    { id: UNCATEGORIZED, name: messages.base.kanbanUncategorized, color: "slate" },
  ];
  // `groupBy` keys the unset bucket as null; the board calls it UNCATEGORIZED.
  // The key is stringified because the endpoint can now also answer with typed
  // keys under `bucketing: "sql"` — a board is always on the default GRID
  // bucketing, where a select's keys are strings, so this only satisfies the
  // wider type rather than changing what the board sees.
  const countByColumn = new Map<string, number>(
    (countsQuery.data?.groups ?? []).map((group) => [
      group.value === null || group.value === undefined ? UNCATEGORIZED : String(group.value),
      group.count,
    ]),
  );

  const canDrag =
    Boolean(onMoveRecord) && !isAnon && hasApiKeyLevel(permissionLevel, "changeRequest");
  const handleDrop = async (columnId: string) => {
    const record = dragging;
    setDragging(null);
    setOverColumn(null);
    if (!record || !onMoveRecord || !canDrag) {
      return;
    }
    const current = record.headCommit.payload[stackField.slug];
    const nextValue = columnId === UNCATEGORIZED ? null : columnId;
    if (current === nextValue || (current == null && nextValue === null)) {
      return;
    }
    setMoveError(null);
    setReviewRequestId(null);
    try {
      const result = await onMoveRecord(record, stackField.slug, nextValue);
      if (!result.materialized) setReviewRequestId(result.changeRequestId);
    } catch (error) {
      setMoveError(presentCoreError(messages, locale, error, messages.shell.operationFailed));
    }
  };

  return (
    <>
      <DragReviewNotice
        currentSearch={currentSearch}
        error={moveError}
        reviewRequestId={reviewRequestId}
      />
      <div className="flex gap-3 overflow-x-auto pb-5">
        {columns.map((column) => {
          // Hide Uncategorized when nothing is unset (keeps the board tidy).
          // `groupBy` OMITS zero-count buckets, so "no entry" — not a 0 — is what
          // an empty bucket looks like; waiting for the aggregate to arrive first
          // keeps the column from flickering away while it loads.
          if (
            column.id === UNCATEGORIZED &&
            countsQuery.data &&
            (countByColumn.get(UNCATEGORIZED) ?? 0) === 0
          ) {
            return null;
          }
          return (
            <KanbanColumn
              base={base}
              showFieldLabels={activeView?.config.showFieldLabels ?? true}
              canDrag={canDrag}
              client={client}
              column={column}
              coverField={coverField}
              coverFit={activeView?.config.coverFit ?? "cover"}
              count={countByColumn.get(column.id)}
              fields={fields}
              isOver={overColumn === column.id}
              key={column.id}
              onDragOverColumn={() => setOverColumn(column.id)}
              onDragStartRecord={setDragging}
              onDrop={() => void handleDrop(column.id)}
              onOpenRecord={onOpenRecord}
              stackField={stackField}
              viewId={activeView?.id}
            />
          );
        })}
      </div>
    </>
  );
}

/**
 * Feedback after a drag on a board or timeline: the error when the write
 * failed, or — for a `changeRequest`-level viewer whose move was queued rather
 * than merged — a note saying so, linking to the pending request.
 */
export function DragReviewNotice({
  currentSearch,
  error,
  reviewRequestId,
}: {
  currentSearch: string;
  error: string | null;
  reviewRequestId: string | null;
}) {
  const messages = useCoreI18n();
  return (
    <>
      {error ? (
        <div className="mb-3 text-destructive text-sm" role="alert">
          {error}
        </div>
      ) : null}
      {reviewRequestId ? (
        <div
          aria-live="polite"
          className="mb-3 text-muted-foreground text-sm"
          data-testid="drag-review-notice"
          role="status"
        >
          {messages.base.dragSubmittedForReview}{" "}
          <Link
            className="text-primary underline-offset-2 hover:underline"
            href={mergeSearchIntoHref(`/inbox/${reviewRequestId}`, currentSearch)}
          >
            {messages.base.viewSubmittedRequest}
          </Link>
        </div>
      ) : null}
    </>
  );
}
