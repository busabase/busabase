import { useQuery } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, ViewConfigVO, ViewSummaryFunction } from "busabase-contract/types";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { Check, ChevronDown, CircleAlert, Clock3 } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale, useIString } from "../../../i18n";
import {
  type GridGroupSummaryMessages,
  gridGroupSummaryMessages,
  shortSummaryLabel,
  summaryMenuLabel,
} from "../../../i18n/grid-group-summary";
import { retryRecordRead } from "../helpers/query-state";
import {
  buildSummaryAggregates,
  computeSummaryValue,
  formatSummaryValue,
  getFieldSummaryFunctions,
  type ResolvedFieldSummary,
  resolveViewFieldSummaries,
  type SummaryBucket,
  setViewFieldSummary,
} from "../helpers/view-summaries";
import { useDashboardOrpc } from "../orpc-context";

/** Sticky classes shared with the grid's frozen primary column (see base-table.tsx). */
const footerStickyCellClassName = "sticky z-10 border-border/70 border-r bg-muted shadow-sm";

/** One summary's label + value, as a footer or group-header cell renders it. */
export function SummaryValueText({
  summary,
  bucket,
  state = "ready",
}: {
  summary: ResolvedFieldSummary;
  bucket: SummaryBucket | undefined;
  state?: "ready" | "loading" | "error";
}) {
  const locale = useCoreLocale();
  const messages = useCoreI18n();
  const copy = gridGroupSummaryMessages[locale];
  const text =
    state === "loading"
      ? "…"
      : state === "error"
        ? "—"
        : formatSummaryValue(summary, computeSummaryValue(summary, bucket), locale, messages);
  return (
    <span
      className="ml-auto inline-flex min-w-0 items-baseline gap-1.5 truncate"
      data-summary-fn={summary.fn}
      data-summary-value={state === "ready" ? text : undefined}
      title={state === "error" ? copy.summaryUnavailable : undefined}
    >
      <span className="shrink-0 text-muted-foreground">{shortSummaryLabel(copy, summary.fn)}</span>
      <span className="truncate font-medium text-foreground tabular-nums">{text}</span>
    </span>
  );
}

interface GridSummaryFooterProps {
  client: BusabaseDashboardApiClient;
  baseId: string;
  viewId: string;
  find?: { query: string; fieldId?: string };
  config: ViewConfigVO;
  /** Visible columns in display order. */
  fields: BaseFieldVO[];
  /** Every live field of the Base (stale summary entries are pruned against it). */
  allFields: BaseFieldVO[];
  columnTemplate: string;
  hasSelectionColumn: boolean;
  /** Shown in the primary column; undefined while unknown. */
  recordCount?: { count: number; capped?: boolean };
  /** Viewers who may change the view get the summary menus. */
  canEdit: boolean;
  /** Whether a change merges immediately (write) or is queued for review. */
  canMerge: boolean;
  onSubmit: (
    fieldSummaries: Record<string, ViewSummaryFunction>,
    mergeImmediately: boolean,
  ) => Promise<void>;
  /** The table's horizontal scroller, mirrored so cells stay under their columns. */
  scrollSourceRef: RefObject<HTMLElement | null>;
}

/**
 * The grid's footer row: one summary cell per visible column, sticky at the
 * bottom of the scroll area. Values cover the whole view (its filters and the
 * active find), never just the loaded page — they come from one
 * `records.groupBy` call. A viewer who cannot read that aggregate sees the
 * labels without values; the grid itself never depends on it.
 */
export function GridSummaryFooter(props: GridSummaryFooterProps) {
  const { allFields, canMerge, config, onSubmit } = props;
  // A choice merges a whole `fieldSummaries` map, so two quick choices both
  // computed from the saved config would drop one of them (or conflict at
  // merge). Choices that merge immediately therefore run one at a time, each
  // computed from the previous one, and show at once: `optimistic` is laid over
  // the saved config until it catches up. A proposal stays a change against
  // the saved config alone — it is reviewed on its own, not on top of others.
  const savedKey = summaryMapKey(config.fieldSummaries);
  const [optimistic, setOptimistic] = useState<Record<string, ViewSummaryFunction> | null>(null);
  const [inFlight, setInFlight] = useState(0);
  // The saved config when the last queued write finished: a later one is news.
  const [savedWhenIdle, setSavedWhenIdle] = useState<string | null>(null);
  const latestRef = useRef<Record<string, ViewSummaryFunction> | null>(null);
  const inFlightRef = useRef(0);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const savedKeyRef = useRef(savedKey);
  savedKeyRef.current = savedKey;
  const optimisticKey = optimistic ? summaryMapKey(optimistic) : null;
  useEffect(() => {
    if (optimisticKey === null) return;
    // Caught up — or, with nothing left in flight, the saved config moved on
    // after our writes (another person, a rejected write): it is the truth.
    if (
      optimisticKey === savedKey ||
      (inFlight === 0 && savedWhenIdle !== null && savedKey !== savedWhenIdle)
    ) {
      setOptimistic(null);
      latestRef.current = null;
    }
  }, [inFlight, optimisticKey, savedKey, savedWhenIdle]);

  const submitSummary = (fieldSlug: string, fn: ViewSummaryFunction | null): Promise<void> => {
    if (!canMerge) {
      return onSubmit(setViewFieldSummary(config, allFields, fieldSlug, fn), false);
    }
    const base = latestRef.current ?? config.fieldSummaries ?? {};
    const next = setViewFieldSummary({ fieldSummaries: base }, allFields, fieldSlug, fn);
    latestRef.current = next;
    setOptimistic(next);
    inFlightRef.current += 1;
    setInFlight(inFlightRef.current);
    const run = queueRef.current.then(() => onSubmit(next, true));
    queueRef.current = run.catch(() => undefined);
    return run
      .catch((error: unknown) => {
        // Show what is actually saved again; later queued writes still carry
        // their own complete map.
        setOptimistic(null);
        latestRef.current = null;
        throw error;
      })
      .finally(() => {
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) setSavedWhenIdle(savedKeyRef.current);
        setInFlight(inFlightRef.current);
      });
  };

  const effectiveConfig = optimistic ? { ...config, fieldSummaries: optimistic } : config;
  const summaries = resolveViewFieldSummaries(effectiveConfig, allFields);
  if (summaries.size === 0 && !props.canEdit) return null;
  // One component whether or not any summary is set yet, so setting the first
  // one does not remount the row (and close a menu someone just opened).
  return (
    <GridSummaryFooterWithTotals
      {...props}
      config={effectiveConfig}
      submitSummary={submitSummary}
      summaries={summaries}
    />
  );
}

/** Order-independent identity of a summaries map. */
const summaryMapKey = (map: Record<string, ViewSummaryFunction> | undefined) =>
  JSON.stringify(Object.entries(map ?? {}).sort(([left], [right]) => left.localeCompare(right)));

function GridSummaryFooterWithTotals(
  props: GridSummaryFooterProps & {
    summaries: Map<string, ResolvedFieldSummary>;
    submitSummary: (fieldSlug: string, fn: ViewSummaryFunction | null) => Promise<void>;
  },
) {
  const orpc = useDashboardOrpc();
  const aggregates = buildSummaryAggregates(props.summaries.values());
  const totals = useQuery({
    // No summary set yet: nothing to fetch, the row only offers the menus.
    enabled: aggregates.length > 0,
    queryKey: [
      // Under the listPage prefix so every record invalidation (refresh, live
      // sync) that refreshes the grid's rows refreshes its totals too.
      ...(orpc?.records.listPage.key() ?? ["busabase"]),
      "grid-summary",
      props.baseId,
      props.viewId,
      props.find ?? null,
      aggregates,
    ],
    queryFn: () =>
      props.client.groupRecords({
        baseId: props.baseId,
        viewId: props.viewId,
        ...(props.find ? { find: props.find } : {}),
        aggregates,
      }),
    placeholderData: (previous) => previous,
    // One retry for a transient failure, then the row shows dashes: the grid
    // never waits on its footer.
    retry: (failureCount, error) => failureCount < 1 && retryRecordRead(failureCount, error),
  });
  const bucket = totals.data?.groups[0];
  return (
    <GridSummaryFooterRow
      {...props}
      bucket={bucket ?? (totals.data ? { count: 0 } : undefined)}
      recordCount={totals.data ? { count: totals.data.total } : props.recordCount}
      state={
        aggregates.length === 0
          ? "ready"
          : totals.isError
            ? "error"
            : totals.data
              ? "ready"
              : "loading"
      }
    />
  );
}

function GridSummaryFooterRow({
  bucket,
  canEdit,
  canMerge,
  columnTemplate,
  config,
  fields,
  hasSelectionColumn,
  recordCount,
  scrollSourceRef,
  state,
  submitSummary,
  summaries,
}: GridSummaryFooterProps & {
  summaries: Map<string, ResolvedFieldSummary>;
  submitSummary: (fieldSlug: string, fn: ViewSummaryFunction | null) => Promise<void>;
  bucket?: SummaryBucket;
  state: "ready" | "loading" | "error";
}) {
  const messages = useCoreI18n();
  const copy = gridGroupSummaryMessages[useCoreLocale()];
  const footerRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState<{
    slug: string;
    kind: "pending" | "error";
  } | null>(null);

  // Keep the footer and the table on one horizontal position. The footer lives
  // outside the table's scroller so it can stick to the bottom of the page's
  // vertical scroll, so the two are synced both ways: focusing or clicking a
  // footer cell past the right edge scrolls the FOOTER into view (overflow
  // hidden still scrolls for focus), and the table has to follow it or every
  // summary would sit under the wrong column. Equal positions are skipped, so
  // the pair settles after one round instead of echoing scroll events.
  useEffect(() => {
    const source = scrollSourceRef.current;
    const footer = footerRef.current;
    if (!source || !footer) return;
    const fromTable = () => {
      if (footer.scrollLeft !== source.scrollLeft) footer.scrollLeft = source.scrollLeft;
    };
    const fromFooter = () => {
      if (source.scrollLeft !== footer.scrollLeft) source.scrollLeft = footer.scrollLeft;
    };
    fromTable();
    source.addEventListener("scroll", fromTable, { passive: true });
    footer.addEventListener("scroll", fromFooter, { passive: true });
    return () => {
      source.removeEventListener("scroll", fromTable);
      footer.removeEventListener("scroll", fromFooter);
    };
  }, [scrollSourceRef]);

  // A pending proposal clears once the merged view carries it.
  useEffect(() => {
    if (feedback?.kind === "pending" && config.fieldSummaries?.[feedback.slug] !== undefined)
      setFeedback(null);
  }, [config.fieldSummaries, feedback]);

  const choose = async (field: BaseFieldVO, fn: ViewSummaryFunction | null) => {
    setFeedback(null);
    try {
      await submitSummary(field.slug, fn);
      if (!canMerge) setFeedback({ slug: field.slug, kind: "pending" });
    } catch {
      setFeedback({ slug: field.slug, kind: "error" });
    }
  };

  return (
    <div
      aria-label={copy.summaries}
      className="sticky bottom-0 z-30 mb-5 overflow-hidden border-border/50 border-t bg-background"
      data-testid="grid-summary-footer"
      ref={footerRef}
      role="group"
    >
      <div
        className="grid h-9 w-max min-w-full items-stretch border-border/50 border-l bg-muted/45 text-xs"
        style={{ gridTemplateColumns: columnTemplate }}
      >
        {hasSelectionColumn ? (
          <div className={`left-0 ${footerStickyCellClassName} border-r-0`} />
        ) : null}
        {fields.map((field, index) => (
          <GridSummaryCell
            canEdit={canEdit}
            feedback={feedback?.slug === field.slug ? feedback.kind : null}
            field={field}
            key={field.id}
            leading={
              index === 0 && recordCount ? (
                <span className="shrink-0 text-muted-foreground" data-testid="grid-summary-count">
                  {fmt(messages.base.recordCount, {
                    count: recordCount.capped ? `${recordCount.count}+` : recordCount.count,
                    plural: recordCount.count === 1 ? "" : "s",
                  })}
                </span>
              ) : null
            }
            messages={copy}
            onChoose={(fn) => void choose(field, fn)}
            stickyClassName={
              index === 0
                ? `${footerStickyCellClassName} ${hasSelectionColumn ? "left-9" : "left-0"}`
                : ""
            }
            summary={summaries.get(field.slug)}
            bucket={bucket}
            state={state}
          />
        ))}
      </div>
      {feedback ? (
        <span className="sr-only" role={feedback.kind === "error" ? "alert" : "status"}>
          {feedback.kind === "error" ? copy.summaryFailed : copy.summaryPending}
        </span>
      ) : null}
    </div>
  );
}

function GridSummaryCell({
  bucket,
  canEdit,
  feedback,
  field,
  leading,
  messages,
  onChoose,
  state,
  stickyClassName,
  summary,
}: {
  bucket?: SummaryBucket;
  canEdit: boolean;
  feedback: "pending" | "error" | null;
  field: BaseFieldVO;
  leading: ReactNode;
  messages: GridGroupSummaryMessages;
  onChoose: (fn: ViewSummaryFunction | null) => void;
  state: "ready" | "loading" | "error";
  stickyClassName: string;
  summary: ResolvedFieldSummary | undefined;
}) {
  const resolveIString = useIString();
  const [open, setOpen] = useState(false);
  const fieldName = resolveIString(field.name);
  // Some types have nothing worth summarizing (created time, created by, ...):
  // their cell stays plain, with no menu to open.
  const functions = getFieldSummaryFunctions(field);
  const editable = canEdit && functions.length > 0;
  const content = (
    <>
      {leading}
      {summary ? (
        <SummaryValueText bucket={bucket} state={state} summary={summary} />
      ) : editable ? (
        <span className="ml-auto inline-flex items-center gap-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/summary:opacity-100 group-focus-visible/summary:opacity-100">
          {messages.summarize}
          <ChevronDown aria-hidden className="size-3" />
        </span>
      ) : null}
      {feedback ? (
        <span
          aria-hidden
          className={feedback === "error" ? "text-destructive" : "text-muted-foreground"}
          title={feedback === "error" ? messages.summaryFailed : messages.summaryPending}
        >
          {feedback === "error" ? <CircleAlert size={11} /> : <Clock3 size={11} />}
        </span>
      ) : null}
    </>
  );
  const cellClassName = `flex min-w-0 items-center gap-2 border-border/40 border-r px-2 ${stickyClassName}`;
  if (!editable) {
    return (
      <div className={cellClassName} data-summary-field={field.slug}>
        {content}
      </div>
    );
  }
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={`${messages.summarize}: ${fieldName}`}
          className={`group/summary text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${cellClassName}`}
          data-summary-field={field.slug}
          type="button"
        >
          {content}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1" side="top">
        <div aria-label={`${messages.summarize}: ${fieldName}`} role="menu">
          {[null, ...functions].map((fn) => {
            const checked = (summary?.fn ?? null) === fn;
            return (
              <button
                aria-checked={checked}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                data-testid={`summary-option-${fn ?? "none"}`}
                key={fn ?? "none"}
                onClick={() => {
                  setOpen(false);
                  if (!checked) onChoose(fn);
                }}
                role="menuitemradio"
                type="button"
              >
                <Check aria-hidden className={`size-3.5 ${checked ? "" : "invisible"}`} />
                {fn ? summaryMenuLabel(messages, fn) : messages.summaryNone}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
