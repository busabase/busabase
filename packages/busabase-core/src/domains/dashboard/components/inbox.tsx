import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { ChangeRequestStatus, ChangeRequestVO } from "busabase-contract/types";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type ReactNode, useMemo, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { type ActivityEvent, buildActivityEventFromItem } from "../helpers/activity-events";
import {
  changeRequestStatusLabel,
  getChangeRequestMessage,
  getChangeRequestOperationLabel,
  getChangeRequestRiskHints,
  getChangeRequestScopeName,
  getChangeRequestSummary,
  getChangeRequestTitle,
  statusTone,
} from "../helpers/change-request";
import { formatListTime, formatUserRefLabel } from "../helpers/format";
import { type InboxViewKey, inboxTabLabel } from "../helpers/inbox";
import type { BusabaseListGroup } from "../helpers/view-types";
import { ActivityRow } from "./activity";
import { EmptyState } from "./primitives";
import { InboxListSkeleton } from "./skeletons";

function BusabaseList({
  empty,
  groups,
  toolbar,
  hasMore,
  isLoadingMore,
  onLoadMore,
  isLoading,
  isError,
  onRetry,
  errorBody,
}: {
  empty: ReactNode;
  groups: BusabaseListGroup[];
  toolbar?: ReactNode;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** True while the first page is still in flight — renders a skeleton, never the empty state (a "0 rows" empty state is otherwise indistinguishable from "still loading"). */
  isLoading?: boolean;
  /** True when the page query failed — renders a retry prompt instead of silently falling back to the empty state. */
  isError?: boolean;
  onRetry?: () => void;
  errorBody?: string;
}) {
  const messages = useCoreI18n();
  const visibleGroups = groups.filter((group) =>
    typeof group.count === "number" ? group.count > 0 : Boolean(group.items),
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {toolbar ? (
        <div className="flex items-center justify-between gap-4 border-b px-5 py-2.5">
          {toolbar}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
        {isLoading ? (
          <InboxListSkeleton />
        ) : isError ? (
          <EmptyState
            action={
              <button
                className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 font-medium text-xs transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => onRetry?.()}
                type="button"
              >
                {messages.inbox.retry}
              </button>
            }
            body={errorBody ?? messages.inbox.loadFailedBody}
            title={messages.inbox.loadFailedTitle}
          />
        ) : visibleGroups.length > 0 ? (
          <div className="space-y-3">
            {visibleGroups.map((group, index) => (
              <div key={`${group.title ?? "list"}-${index}`}>
                {group.title ? (
                  <div className="rounded-md bg-muted/40 px-3 py-1.5 font-medium text-muted-foreground text-xs">
                    {group.title}
                    {typeof group.count === "number" ? (
                      <span className="ml-1 font-mono">{group.count}</span>
                    ) : null}
                  </div>
                ) : null}
                <div className="divide-y">{group.items}</div>
              </div>
            ))}
          </div>
        ) : (
          empty
        )}
        {!isLoading && !isError && hasMore ? (
          <div className="flex items-center justify-center pt-4">
            <button
              className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
              disabled={isLoadingMore}
              onClick={() => onLoadMore?.()}
              type="button"
            >
              {isLoadingMore ? messages.common.loading : messages.search.loadMore}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const INBOX_PAGE_SIZE = 50;

// Server-side filter for each inbox tab. The paginated list + counts endpoints
// resolve `mine` / `status` against the request context, so tab badges and rows
// stay correct no matter how many change requests exist.
const tabFilter = (tab: InboxViewKey): { status?: ChangeRequestStatus[]; mine?: boolean } => {
  switch (tab) {
    case "changes":
      return { status: ["changes_requested"] };
    case "created":
      return { mine: true };
    case "approved":
      return { status: ["approved"] };
    case "merged":
      return { status: ["merged"] };
    case "rejected":
      return { status: ["rejected", "abandoned"] };
    default:
      return { status: ["in_review"] };
  }
};

export function InboxView({
  activeView,
  emptyGuide,
  orpc,
  onBatchReview,
  isBatchPending,
}: {
  activeView: InboxViewKey;
  emptyGuide?: ReactNode;
  orpc: BusabaseQueryUtils;
  onBatchReview: (action: "approveMerge" | "reject", ids: string[], reason?: string) => void;
  isBatchPending: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <InboxList
        activeView={activeView}
        emptyGuide={emptyGuide}
        orpc={orpc}
        onBatchReview={onBatchReview}
        isBatchPending={isBatchPending}
      />
    </div>
  );
}

function InboxList({
  activeView,
  emptyGuide,
  orpc,
  onBatchReview,
  isBatchPending,
}: {
  activeView: InboxViewKey;
  emptyGuide?: ReactNode;
  orpc: BusabaseQueryUtils;
  onBatchReview: (action: "approveMerge" | "reject", ids: string[], reason?: string) => void;
  isBatchPending: boolean;
}) {
  const messages = useCoreI18n();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Whole-space tab counts (not derived from a capped page).
  const countsQuery = useQuery(orpc.changeRequests.counts.queryOptions({}));
  const counts = countsQuery.data;
  const inboxCounts: Record<InboxViewKey, number> = {
    approved: counts?.approved ?? 0,
    changes: counts?.changes ?? 0,
    created: counts?.created ?? 0,
    merged: counts?.merged ?? 0,
    rejected: counts?.rejected ?? 0,
    review: counts?.review ?? 0,
  };

  // The active tab's rows load via keyset pagination ("load more").
  const listQuery = useInfiniteQuery({
    ...orpc.changeRequests.listPaged.infiniteOptions({
      input: (pageParam: string | undefined) => ({
        ...tabFilter(activeView),
        cursor: pageParam,
        limit: INBOX_PAGE_SIZE,
      }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
  });
  const activeChangeRequests = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.changeRequests) ?? [],
    [listQuery.data],
  );

  // Selection + batch actions are offered on the review queue (the import
  // approve → merge path). Selection is scoped to the ids currently loaded.
  const selectable = activeView === "review";
  const selected = useMemo(
    () => activeChangeRequests.map((cr) => cr.id).filter((id) => selectedIds.has(id)),
    [activeChangeRequests, selectedIds],
  );
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  const clearSelection = () => setSelectedIds(new Set());

  const renderRow = (changeRequest: ChangeRequestVO) =>
    selectable ? (
      <SelectableChangeRequestRow
        changeRequest={changeRequest}
        key={changeRequest.id}
        onToggle={() => toggleSelected(changeRequest.id)}
        selected={selectedIds.has(changeRequest.id)}
      />
    ) : (
      <ReviewChangeRequestRow changeRequest={changeRequest} key={changeRequest.id} />
    );

  const isOpenStatus = (status: ChangeRequestVO["status"]) =>
    status === "in_review" || status === "changes_requested" || status === "approved";
  const openCreated = activeChangeRequests.filter((changeRequest) =>
    isOpenStatus(changeRequest.status),
  );
  const closedCreated = activeChangeRequests.filter(
    (changeRequest) => !isOpenStatus(changeRequest.status),
  );
  const groups =
    activeView === "created"
      ? [
          {
            count: openCreated.length,
            items: openCreated.map(renderRow),
            title: messages.inbox.openChangeRequests,
          },
          {
            count: closedCreated.length,
            items: closedCreated.map(renderRow),
            title: messages.inbox.closedChangeRequests,
          },
        ]
      : [
          {
            count: activeChangeRequests.length,
            items: activeChangeRequests.map(renderRow),
          },
        ];

  return (
    <BusabaseList
      empty={
        <EmptyState
          title={fmt(messages.inbox.empty, { label: inboxTabLabel(messages, activeView) })}
          body={messages.inbox.emptyBody}
          action={emptyGuide}
        />
      }
      groups={groups}
      hasMore={listQuery.hasNextPage}
      isLoadingMore={listQuery.isFetchingNextPage}
      onLoadMore={() => {
        void listQuery.fetchNextPage();
      }}
      isLoading={listQuery.isLoading}
      isError={listQuery.isError}
      errorBody={listQuery.error instanceof Error ? listQuery.error.message : undefined}
      onRetry={() => {
        void listQuery.refetch();
      }}
      toolbar={
        <>
          <BusabaseListToolbar activeView={activeView} counts={inboxCounts} />
          {selectable && selected.length > 0 ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-muted-foreground text-xs">
                {fmt(messages.inbox.selectedCount, { count: selected.length })}
              </span>
              <button
                className="inline-flex h-7 items-center rounded-md bg-foreground px-2.5 font-medium text-background text-xs transition-colors hover:bg-foreground/85 disabled:opacity-60"
                disabled={isBatchPending}
                onClick={() => {
                  onBatchReview("approveMerge", selected);
                  clearSelection();
                }}
                type="button"
              >
                {messages.inbox.batchApproveMerge}
              </button>
              <button
                className="inline-flex h-7 items-center rounded-md border border-border/70 px-2.5 font-medium text-xs transition-colors hover:bg-accent disabled:opacity-60"
                disabled={isBatchPending}
                onClick={() => {
                  onBatchReview("reject", selected);
                  clearSelection();
                }}
                type="button"
              >
                {messages.inbox.batchReject}
              </button>
              <button
                className="text-muted-foreground text-xs underline-offset-2 hover:underline"
                onClick={clearSelection}
                type="button"
              >
                {messages.inbox.clearSelection}
              </button>
            </div>
          ) : null}
        </>
      }
    />
  );
}

function SelectableChangeRequestRow({
  changeRequest,
  onToggle,
  selected,
}: {
  changeRequest: ChangeRequestVO;
  onToggle: () => void;
  selected: boolean;
}) {
  const messages = useCoreI18n();
  return (
    <div className="flex items-center gap-2 pl-3">
      <input
        aria-label={getChangeRequestTitle(changeRequest, messages)}
        checked={selected}
        className="size-4 shrink-0 accent-foreground"
        onChange={onToggle}
        type="checkbox"
      />
      <div className="min-w-0 flex-1">
        <ReviewChangeRequestRow changeRequest={changeRequest} />
      </div>
    </div>
  );
}

function BusabaseListToolbar({
  activeView,
  counts,
}: {
  activeView: InboxViewKey;
  counts: Record<InboxViewKey, number>;
}) {
  const messages = useCoreI18n();
  const tabs: InboxViewKey[] = ["review", "changes", "created", "approved", "merged", "rejected"];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {tabs.map((tab) => {
        const active = tab === activeView;

        return (
          <Link
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-xs transition-colors ${
              active
                ? "bg-background text-foreground shadow-sm"
                : "bg-muted/25 text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            href={tab === "review" ? "/inbox" : `/inbox?view=${tab}`}
            key={tab}
          >
            <span>{inboxTabLabel(messages, tab)}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{counts[tab]}</span>
          </Link>
        );
      })}
    </div>
  );
}

function ReviewChangeRequestRow({ changeRequest }: { changeRequest: ChangeRequestVO }) {
  const messages = useCoreI18n();
  const updatedAt = formatListTime(changeRequest.updatedAt);
  const riskHints = getChangeRequestRiskHints(changeRequest, messages);
  const statusLabel = changeRequestStatusLabel(changeRequest.status, messages);
  const message = getChangeRequestMessage(changeRequest);
  const submitterLabel = formatUserRefLabel(
    changeRequest.submittedByUser,
    changeRequest.submittedBy,
    messages,
  );

  return (
    <Link
      className="group grid min-h-14 items-center gap-2 px-3 py-2.5 transition-colors hover:bg-accent/25 md:grid-cols-[minmax(0,1fr)_220px]"
      href={`/inbox/${changeRequest.id}`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`size-2 shrink-0 rounded-full border ${statusTone(changeRequest.status)}`}
            title={statusLabel}
          />
          <div className="truncate font-semibold text-sm leading-5">
            {getChangeRequestTitle(changeRequest, messages)}
          </div>
          {riskHints.length > 0 ? (
            <span className="hidden shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-[11px] text-amber-800 sm:inline-flex">
              {riskHints.join(" · ")}
            </span>
          ) : null}
        </div>
        {message ? (
          <div className="mt-0.5 truncate text-muted-foreground text-xs">{message}</div>
        ) : null}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
          <span className="truncate">{getChangeRequestScopeName(changeRequest, messages)}</span>
          <span>·</span>
          <span>{getChangeRequestOperationLabel(changeRequest, messages)}</span>
          <span>·</span>
          <span className="min-w-0 truncate">
            {messages.review.submittedBy} {submitterLabel}
          </span>
          <span>·</span>
          <span>{statusLabel}</span>
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 text-muted-foreground text-xs md:justify-end">
        <span className="hidden min-w-0 truncate md:block">
          {getChangeRequestSummary(changeRequest, messages)}
        </span>
        <span className="shrink-0 font-mono text-[11px] transition-colors group-hover:text-foreground">
          {updatedAt}
        </span>
      </div>
    </Link>
  );
}

const ACTIVITY_PAGE_SIZE = 40;

export function ActivityView({
  orpc,
  emptyGuide,
}: {
  orpc: BusabaseQueryUtils;
  emptyGuide?: ReactNode;
}) {
  const messages = useCoreI18n();
  // Keyset-paginated feed (activity.listPaged) — the whole CR/record/audit tables
  // are no longer pulled into the browser; each page is rendered from descriptors.
  const listQuery = useInfiniteQuery({
    ...orpc.activity.listPaged.infiniteOptions({
      input: (pageParam: string | undefined) => ({ cursor: pageParam, limit: ACTIVITY_PAGE_SIZE }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
  });
  const events = useMemo(
    () =>
      (listQuery.data?.pages.flatMap((page) => page.items) ?? [])
        .map((item) => buildActivityEventFromItem(item, messages))
        .filter((event): event is ActivityEvent => event !== null),
    [listQuery.data, messages],
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recentEvents = events.filter((event) => new Date(event.timestamp) >= today);
  const earlierEvents = events.filter((event) => new Date(event.timestamp) < today);
  const activityGroups = [
    {
      count: recentEvents.length,
      items: recentEvents.map((event) => <ActivityRow event={event} key={event.id} />),
      title: messages.activity.today,
    },
    {
      count: earlierEvents.length,
      items: earlierEvents.map((event) => <ActivityRow event={event} key={event.id} />),
      title: messages.activity.earlier,
    },
  ].filter((group) => group.count > 0);
  const loadError =
    listQuery.error instanceof Error ? listQuery.error.message : messages.inbox.loadFailedBody;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-2.5">
        <div className="font-medium text-sm">{messages.activity.workspaceActivity}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5">
        {listQuery.isPending ? (
          <InboxListSkeleton />
        ) : listQuery.isError ? (
          <EmptyState
            action={
              <button
                className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 font-medium text-xs transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => listQuery.refetch()}
                type="button"
              >
                {messages.inbox.retry}
              </button>
            }
            body={loadError}
            title={messages.inbox.loadFailedTitle}
          />
        ) : activityGroups.length > 0 ? (
          <div className="w-full space-y-6">
            {activityGroups.map((group) => (
              <div key={group.title}>
                <div className="mb-1.5 flex items-center gap-2 px-2 text-muted-foreground text-xs">
                  <span className="font-medium">{group.title}</span>
                  <span className="font-mono">{group.count}</span>
                </div>
                <div>{group.items}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full">
            <EmptyState
              title={messages.activity.noActivityTitle}
              body={messages.activity.noActivityBody}
              action={emptyGuide}
            />
          </div>
        )}
        {!listQuery.isPending && !listQuery.isError && listQuery.hasNextPage ? (
          <div className="flex items-center justify-center pt-4">
            <button
              className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
              disabled={listQuery.isFetchingNextPage}
              onClick={() => listQuery.fetchNextPage()}
              type="button"
            >
              {listQuery.isFetchingNextPage ? messages.common.loading : messages.search.loadMore}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
