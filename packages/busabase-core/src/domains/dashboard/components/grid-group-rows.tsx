import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO } from "busabase-contract/types";
import { CheckSquare, ChevronDown, ChevronRight, LoaderCircle, Square } from "lucide-react";
import { type CSSProperties, useEffect } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { gridGroupSummaryMessages } from "../../../i18n/grid-group-summary";
import { getFieldChipEntries } from "../helpers/field";
import type { ResolvedViewGrouping } from "../helpers/view-grouping";
import type { ResolvedFieldSummary, SummaryAggregate } from "../helpers/view-summaries";
import {
  GRID_GROUP_PAGE_SIZE,
  type GroupedGridData,
  type GroupedGridGroup,
  useGroupedGridData,
} from "../hooks/use-grouped-grid-data";
import { FieldBadge } from "./field-preview";
import { SummaryValueText } from "./grid-summary-footer";

/** Group header and group footer row heights (px), for the virtualizer's estimates. */
export const GRID_GROUP_HEADER_HEIGHT = 40;
export const GRID_GROUP_FOOTER_HEIGHT = 40;

export type ScopedGroupedGridData = GroupedGridData & { scope: string };

/**
 * Runs a grouped table's queries and hands the result to the table, which
 * renders it through its ordinary row renderer. A separate component so the
 * queries exist only while a valid grouping is shown; mount it with a `key`
 * that changes with the grouping so collapse/paging state starts fresh.
 */
export function GroupedGridDataSource({
  aggregates,
  base,
  client,
  find,
  grouping,
  listMode,
  onChange,
  scope,
  viewId,
}: {
  aggregates: SummaryAggregate[];
  base: BaseVO;
  client: BusabaseDashboardApiClient;
  find?: { query: string; fieldId?: string };
  grouping: ResolvedViewGrouping;
  listMode?: "full" | "table";
  onChange: (data: ScopedGroupedGridData) => void;
  scope: string;
  viewId: string;
}) {
  const data = useGroupedGridData({
    aggregates,
    base,
    client,
    find,
    grouping,
    listMode,
    viewId,
  });
  useEffect(() => {
    onChange({ ...data, scope });
  }, [data, onChange, scope]);
  return null;
}

/** The label a group header shows: the select's own choice pill, or the checkbox state. */
function GridGroupLabel({ field, group }: { field: BaseFieldVO; group: GroupedGridGroup }) {
  const copy = gridGroupSummaryMessages[useCoreLocale()];
  if (group.kind === "checked" || group.kind === "unchecked") {
    const Icon = group.kind === "checked" ? CheckSquare : Square;
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{group.kind === "checked" ? copy.checked : copy.unchecked}</span>
      </span>
    );
  }
  if (group.kind === "empty") {
    return <span className="truncate text-muted-foreground italic">{copy.emptyGroup}</span>;
  }
  const [chip] = getFieldChipEntries(field, group.key);
  return chip ? (
    <span className="inline-flex min-w-0">
      <FieldBadge chip={chip} />
    </span>
  ) : (
    <span className="truncate">{group.key}</span>
  );
}

export const gridGroupLabelText = (
  group: GroupedGridGroup,
  copy: (typeof gridGroupSummaryMessages)["en"],
): string =>
  group.kind === "checked"
    ? copy.checked
    : group.kind === "unchecked"
      ? copy.unchecked
      : group.kind === "empty"
        ? copy.emptyGroup
        : (group.choice?.name ?? group.key ?? "");

/**
 * A group's header row: collapse toggle, label and exact count in the frozen
 * primary column, and the group's summaries under their own columns.
 */
export function GridGroupHeaderRow({
  columnTemplate,
  fields,
  grouping,
  group,
  hasSelectionColumn,
  onToggle,
  rowIndex,
  style,
  summaries,
  stickyClassName,
}: {
  columnTemplate: string;
  /** Visible columns in display order. */
  fields: BaseFieldVO[];
  grouping: ResolvedViewGrouping;
  group: GroupedGridGroup;
  hasSelectionColumn: boolean;
  onToggle: () => void;
  rowIndex: number;
  style?: CSSProperties;
  summaries: Map<string, ResolvedFieldSummary>;
  /** The frozen primary column's sticky classes (offset included). */
  stickyClassName: string;
}) {
  const messages = useCoreI18n();
  const copy = gridGroupSummaryMessages[useCoreLocale()];
  const label = gridGroupLabelText(group, copy);
  const countLabel = fmt(messages.base.recordCount, {
    count: group.count,
    plural: group.count === 1 ? "" : "s",
  });
  return (
    <div
      aria-expanded={!group.collapsed}
      aria-rowindex={rowIndex}
      className="grid items-stretch border-border/50 border-b bg-muted text-xs"
      data-group-count={group.count}
      data-group-id={group.id}
      data-testid="grid-group-header"
      role="row"
      tabIndex={-1}
      style={{ gridTemplateColumns: columnTemplate, height: GRID_GROUP_HEADER_HEIGHT, ...style }}
    >
      {hasSelectionColumn ? (
        <div className="sticky left-0 z-10 bg-muted" role="gridcell" tabIndex={-1} />
      ) : null}
      {fields.map((field, index) => {
        const summary = summaries.get(field.slug);
        if (index === 0) {
          return (
            <div
              className={`flex min-w-0 items-center gap-2 border-border/40 border-r px-1.5 ${stickyClassName}`}
              key={field.id}
              role="rowheader"
              tabIndex={-1}
            >
              <button
                aria-expanded={!group.collapsed}
                aria-label={fmt(group.collapsed ? copy.expandGroup : copy.collapseGroup, {
                  group: label,
                })}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="grid-group-toggle"
                onClick={onToggle}
                type="button"
              >
                {group.collapsed ? (
                  <ChevronRight aria-hidden className="size-4" />
                ) : (
                  <ChevronDown aria-hidden className="size-4" />
                )}
              </button>
              <GridGroupLabel field={grouping.field} group={group} />
              <span
                aria-hidden
                className="shrink-0 rounded-md bg-background/70 px-1.5 text-muted-foreground tabular-nums"
                data-testid="grid-group-count"
                title={countLabel}
              >
                {group.count}
              </span>
              <span className="sr-only">{countLabel}</span>
              {summary ? <SummaryValueText bucket={group} summary={summary} /> : null}
            </div>
          );
        }
        return (
          <div
            className="flex min-w-0 items-center border-border/40 border-r px-2"
            data-summary-field={summary ? field.slug : undefined}
            key={field.id}
            role="gridcell"
            tabIndex={-1}
          >
            {summary ? <SummaryValueText bucket={group} summary={summary} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The row after a group's loaded records: "Load more" while the group has
 * rows left, a loading line for its first page, or its error with a retry.
 */
export function GridGroupFooterRow({
  columnCount,
  group,
  onLoadMore,
  onRetry,
  rowIndex,
  style,
}: {
  columnCount: number;
  group: GroupedGridGroup;
  onLoadMore: () => void;
  onRetry: () => void;
  rowIndex: number;
  style?: CSSProperties;
}) {
  const messages = useCoreI18n();
  const copy = gridGroupSummaryMessages[useCoreLocale()];
  const remaining = Math.max(0, group.count - group.records.length);
  return (
    <div
      aria-rowindex={rowIndex}
      className="grid border-border/40 border-b"
      data-group-id={group.id}
      data-testid="grid-group-footer"
      role="row"
      tabIndex={-1}
      style={{ height: GRID_GROUP_FOOTER_HEIGHT, ...style }}
    >
      <div
        aria-colspan={columnCount}
        className="flex items-center"
        role="gridcell"
        style={{ gridColumn: `span ${columnCount}` }}
        tabIndex={-1}
      >
        <div className="sticky left-0 flex items-center gap-2 px-3 text-muted-foreground text-xs">
          {group.status === "error" ? (
            <>
              <span role="alert">{copy.groupLoadFailed}</span>
              <button
                className="underline underline-offset-2 hover:text-foreground"
                onClick={onRetry}
                type="button"
              >
                {copy.retry}
              </button>
            </>
          ) : group.status === "pending" || group.isLoadingMore ? (
            <span className="inline-flex items-center gap-1.5" role="status">
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              {messages.common.loading}
            </span>
          ) : group.hasMore ? (
            <button
              className="inline-flex h-7 items-center rounded-md border border-border/70 bg-card px-2.5 font-medium text-foreground text-xs transition-colors hover:bg-accent"
              data-testid="grid-group-load-more"
              onClick={onLoadMore}
              type="button"
            >
              {fmt(copy.loadMore, { count: Math.min(GRID_GROUP_PAGE_SIZE, remaining) })}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Whether a group needs its footer row (more rows, still loading, or failed). */
export const gridGroupNeedsFooter = (group: GroupedGridGroup): boolean =>
  !group.collapsed && (group.status !== "ready" || group.hasMore || group.isLoadingMore);
