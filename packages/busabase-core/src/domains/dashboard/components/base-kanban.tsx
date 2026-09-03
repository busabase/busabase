import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useState } from "react";
import { useSearch } from "wouter";
import { useCoreI18n, useIString } from "../../../i18n";
import { getPrimaryField } from "../../base/utils/primary-field";
import { getRecordTitle } from "../helpers/change-request";
import { getFieldPreviewText } from "../helpers/field";
import { mergeSearchIntoHref } from "../helpers/link-search";

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

function KanbanCard({
  record,
  fields,
  stackFieldSlug,
  baseSlug,
  draggable,
  onDragStart,
}: {
  record: RecordVO;
  fields: BaseFieldVO[];
  stackFieldSlug: string | undefined;
  baseSlug: string;
  draggable: boolean;
  onDragStart: () => void;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const currentSearch = useSearch();
  const title = getRecordTitle(record, messages);
  const primaryFieldSlug = getPrimaryField(record.base)?.slug;
  const bodyFields = fields.filter(
    (field) => field.slug !== primaryFieldSlug && field.slug !== stackFieldSlug,
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: kanban card is a native HTML5 drag source; the title Link remains the keyboard-accessible affordance
    <div
      className={`rounded-md border border-border/60 bg-background p-2.5 shadow-sm transition-shadow hover:shadow-md ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
    >
      <Link
        className="block truncate font-medium text-foreground text-sm hover:underline"
        href={mergeSearchIntoHref(`/base/${baseSlug}/${record.id}`, currentSearch)}
        title={title}
      >
        {title}
      </Link>
      {bodyFields.slice(0, 3).map((field) => {
        const preview = getFieldPreviewText(field, record.headCommit.payload[field.slug], messages);
        if (!preview || preview === "-") {
          return null;
        }
        return (
          <div
            className="mt-1 truncate text-muted-foreground text-xs"
            key={field.id}
            title={`${resolveIString(field.name)}: ${preview}`}
          >
            {preview}
          </div>
        );
      })}
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
  stackField,
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
  stackField: BaseFieldVO;
  viewId: string | undefined;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const baseId = base?.id ?? "";

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
    queryKey: ["busabase", "kanban-column", baseId, viewId ?? "", stackField.slug, column.id],
  });

  const records = (cardsQuery.data?.pages ?? []).flatMap((page) => page.records);
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
              draggable={canDrag}
              fields={fields}
              key={record.id}
              onDragStart={() => onDragStartRecord(record)}
              record={record}
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
 * Read-only when no move handler is provided.
 */
export function BusaBaseKanban({
  activeView,
  base,
  client,
  fields,
  onMoveRecord,
}: {
  activeView: ViewVO | null;
  base: BaseVO | null;
  client: BusabaseDashboardApiClient;
  fields: BaseFieldVO[];
  onMoveRecord?: (record: RecordVO, fieldSlug: string, value: string | null) => Promise<void>;
}) {
  const messages = useCoreI18n();
  // The dragged RECORD, not just its id: the board no longer holds an array of
  // every record to look one up in.
  const [dragging, setDragging] = useState<RecordVO | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const stackField = resolveStackByField(base, fields, activeView?.config.stackByFieldSlug);
  const baseId = base?.id ?? "";

  const countsQuery = useQuery({
    enabled: Boolean(baseId) && Boolean(stackField),
    queryFn: () =>
      client.groupRecords({
        baseId,
        fieldSlug: stackField?.slug ?? "",
        ...(activeView?.id ? { viewId: activeView.id } : {}),
      }),
    queryKey: ["busabase", "kanban-counts", baseId, activeView?.id ?? "", stackField?.slug ?? ""],
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
  const countByColumn = new Map<string, number>(
    (countsQuery.data?.groups ?? []).map((group) => [group.value ?? UNCATEGORIZED, group.count]),
  );

  const canDrag = Boolean(onMoveRecord);
  const handleDrop = async (columnId: string) => {
    const record = dragging;
    setDragging(null);
    setOverColumn(null);
    if (!record || !onMoveRecord) {
      return;
    }
    const current = record.headCommit.payload[stackField.slug];
    const nextValue = columnId === UNCATEGORIZED ? null : columnId;
    if (current === nextValue || (current == null && nextValue === null)) {
      return;
    }
    await onMoveRecord(record, stackField.slug, nextValue);
  };

  return (
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
            canDrag={canDrag}
            client={client}
            column={column}
            count={countByColumn.get(column.id)}
            fields={fields}
            isOver={overColumn === column.id}
            key={column.id}
            onDragOverColumn={() => setOverColumn(column.id)}
            onDragStartRecord={setDragging}
            onDrop={() => void handleDrop(column.id)}
            stackField={stackField}
            viewId={activeView?.id}
          />
        );
      })}
    </div>
  );
}
