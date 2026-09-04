import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  ChangeRequestStatus,
  ChangeRequestVO,
  MentionInboxItemVO,
} from "busabase-contract/types";
import { ChevronDown, Loader2 } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { type ActivityEvent, buildActivityEventFromItem } from "../helpers/activity-events";
import {
  changeRequestStatusLabel,
  getChangeRequestMessage,
  getChangeRequestOperationLabel,
  getChangeRequestRiskHints,
  getChangeRequestScopeName,
  getChangeRequestSummary,
  getChangeRequestTitle,
  statusAccent,
  statusTone,
} from "../helpers/change-request";
import { formatListTime, formatUserRefLabel } from "../helpers/format";
import { INBOX_VIEW_KEYS, type InboxViewKey, inboxTabLabel } from "../helpers/inbox";
import { useHrefWithCurrentSearch } from "../helpers/link-search";
import { resolveSubmissionIdentity } from "../helpers/source-attribution";
import type { BusabaseListGroup } from "../helpers/view-types";
import { ActivityRow } from "./activity";
import { EmptyState } from "./primitives";
import { type RecordPageSize, RecordsPaginationBar } from "./records-pagination-bar";
import { InboxListSkeleton } from "./skeletons";
import { SourceAttributionInline } from "./source-attribution";

function BusabaseList({
  empty,
  groups,
  toolbar,
  pagination,
  isLoading,
  isError,
  onRetry,
  errorBody,
}: {
  empty: ReactNode;
  groups: BusabaseListGroup[];
  toolbar?: ReactNode;
  /** Rendered in a sticky footer under the list — the shared paginator bar. */
  pagination?: ReactNode;
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
        <div
          className="flex min-h-12 min-w-0 items-center justify-between gap-3 overflow-hidden border-b px-3 py-2 sm:px-5"
          data-testid="inbox-toolbar"
        >
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
      </div>
      {pagination ? <div className="border-t px-3 py-2 sm:px-5">{pagination}</div> : null}
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
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Numbered paging, sharing the Base table's paginator. "Load more" was fine
  // for a handful of pending items, but a reviewer working a tab that holds
  // thousands (a merged/closed history) could only reach page 30 by clicking 29
  // times, and had no idea how many pages there even were.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<RecordPageSize>(INBOX_PAGE_SIZE);
  // Switching tabs restarts at page 1 — page 7 of "for review" means nothing in
  // "merged", and silently landing on it would look like data loss.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on tab change only
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [activeView]);

  const snapshotQuery = useQuery(
    orpc.changeRequests.inboxSnapshot.queryOptions({
      input: { ...tabFilter(activeView), page, pageSize },
    }),
  );
  // Hosts use the standalone counts key for the global Inbox badge. Seeding it
  // from the combined response lets that badge reuse this request while the
  // Inbox route is active; Home and other routes still fetch counts directly.
  useEffect(() => {
    if (snapshotQuery.data?.counts) {
      queryClient.setQueryData(
        orpc.changeRequests.counts.queryOptions({}).queryKey,
        snapshotQuery.data.counts,
      );
    }
  }, [orpc, queryClient, snapshotQuery.data?.counts]);
  // Mentions are comments, not change requests, so they cannot ride
  // `inboxSnapshot` (which is CR-shaped end to end). Separate query, same list
  // primitives. Only fetched while the tab is active — every other tab would
  // otherwise pay for a query it never renders — except the count, which the
  // badge needs even when you are standing somewhere else.
  const mentionsQuery = useQuery({
    ...orpc.comments.listMentions.queryOptions({ input: { page, pageSize } }),
    enabled: activeView === "mentions",
  });
  const mentionCountQuery = useQuery({
    ...orpc.comments.listMentions.queryOptions({ input: { page: 1, pageSize: 1 } }),
    enabled: activeView !== "mentions",
  });
  const unreadMentions =
    activeView === "mentions"
      ? (mentionsQuery.data?.unreadCount ?? 0)
      : (mentionCountQuery.data?.unreadCount ?? 0);

  const markRead = useMutation({
    ...orpc.comments.markMentionsRead.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.comments.listMentions.queryOptions({ input: { page, pageSize } }).queryKey,
      });
    },
  });

  const counts = snapshotQuery.data?.counts;
  const inboxCounts: Record<InboxViewKey, number> = {
    approved: counts?.approved ?? 0,
    changes: counts?.changes ?? 0,
    created: counts?.created ?? 0,
    mentions: unreadMentions,
    merged: counts?.merged ?? 0,
    rejected: counts?.rejected ?? 0,
    review: counts?.review ?? 0,
  };
  const activeChangeRequests = useMemo(
    () => snapshotQuery.data?.changeRequests ?? [],
    [snapshotQuery.data],
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
  const mentionItems = mentionsQuery.data?.items ?? [];
  const isMentions = activeView === "mentions";
  const groups: BusabaseListGroup[] = isMentions
    ? [
        {
          count: mentionItems.length,
          items: mentionItems.map((item) => (
            <MentionRow
              item={item}
              key={item.commentId}
              onOpen={(commentId) => {
                // Optimistic-ish: the row is already navigating away, so the
                // badge should not wait for the round trip to stop counting a
                // comment the reader is, right now, reading.
                if (item.unread) markRead.mutate({ commentId });
              }}
            />
          )),
        },
      ]
    : activeView === "created"
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
          title={
            isMentions
              ? messages.inbox.mentionsEmpty
              : fmt(messages.inbox.empty, { label: inboxTabLabel(messages, activeView) })
          }
          body={isMentions ? messages.inbox.mentionsEmptyBody : messages.inbox.emptyBody}
          action={isMentions ? undefined : emptyGuide}
        />
      }
      groups={groups}
      pagination={
        <RecordsPaginationBar
          isFetching={isMentions ? mentionsQuery.isFetching : snapshotQuery.isFetching}
          isLoading={isMentions ? mentionsQuery.isLoading : snapshotQuery.isLoading}
          onPageChange={setPage}
          onPageSizeChange={(next) => {
            setPageSize(next);
            setPage(1);
          }}
          onRetry={() => {
            void (isMentions ? mentionsQuery.refetch() : snapshotQuery.refetch());
          }}
          page={isMentions ? page : (snapshotQuery.data?.page ?? page)}
          pageSize={pageSize}
          total={isMentions ? (mentionsQuery.data?.total ?? 0) : (snapshotQuery.data?.total ?? 0)}
          totalPages={
            isMentions
              ? Math.max(1, Math.ceil((mentionsQuery.data?.total ?? 0) / pageSize))
              : (snapshotQuery.data?.totalPages ?? 0)
          }
        />
      }
      isLoading={isMentions ? mentionsQuery.isLoading : snapshotQuery.isLoading}
      isError={isMentions ? mentionsQuery.isError : snapshotQuery.isError}
      errorBody={
        (isMentions ? mentionsQuery.error : snapshotQuery.error) instanceof Error
          ? (isMentions ? mentionsQuery.error : snapshotQuery.error)?.message
          : undefined
      }
      onRetry={() => {
        void (isMentions ? mentionsQuery.refetch() : snapshotQuery.refetch());
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
  const tabs = INBOX_VIEW_KEYS;

  return (
    <nav
      aria-label={messages.nav.inbox}
      className="flex h-8 min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="inbox-view-tabs"
    >
      {tabs.map((tab) => {
        const active = tab === activeView;

        return (
          <Link
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-medium text-xs transition-colors ${
              active
                ? "border-border/60 bg-muted/70 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            }`}
            // Every tab must state its own `view` explicitly — including
            // "review", which is the default. `SPALink` merges the CURRENT
            // query string into the href (so unrelated params survive
            // navigation), and a bare `/inbox` therefore carries the existing
            // `?view=changes` straight back in: clicking "For review" from any
            // other tab navigated to the URL it was already on and looked
            // completely dead. Only a literal `view=review` overrides it.
            href={`/inbox?view=${tab}`}
            key={tab}
          >
            <span>{inboxTabLabel(messages, tab)}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{counts[tab]}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * One comment the reader was `@`-mentioned in.
 *
 * Not a `ChangeRequestVO` row: a mention is a comment, so it gets its own
 * renderer rather than being squeezed into the CR shape the other tabs use.
 * Everything around it — list, pagination, empty state — is still shared.
 */
function MentionRow({
  item,
  onOpen,
}: {
  item: MentionInboxItemVO;
  onOpen: (commentId: string) => void;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const href = useHrefWithCurrentSearch(item.href ?? "");
  const author = formatUserRefLabel(item.author, item.authorId, messages);
  const body = (
    <div className="group relative grid min-h-14 items-center gap-1 py-2.5 pr-3 pl-5 transition-colors hover:bg-accent/25">
      {/* Unread rail, same left-edge scanning affordance the CR rows use. */}
      {item.unread ? (
        <span
          aria-hidden
          className="absolute top-2 bottom-2 left-1.5 w-[3px] rounded-full bg-primary"
        />
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-sm">{author}</span>
        {item.unread ? (
          <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-0.5 font-medium text-[10px] text-primary">
            {messages.inbox.mentionsUnread}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-muted-foreground text-xs">
          {formatListTime(item.createdAt, locale)}
        </span>
      </div>
      <p className="truncate text-muted-foreground text-sm">{item.body}</p>
    </div>
  );

  // A `commit`-scoped comment on no change request has no page to open. It
  // still renders — dropping it would be the one case where being mentioned
  // silently never reaches you — but as static text with a reason, not a link
  // that goes nowhere.
  if (!item.href) {
    return (
      <div key={item.commentId} title={messages.inbox.mentionsNoLink}>
        {body}
      </div>
    );
  }
  return (
    <Link href={href} key={item.commentId} onClick={() => onOpen(item.commentId)}>
      {body}
    </Link>
  );
}

function ReviewChangeRequestRow({ changeRequest }: { changeRequest: ChangeRequestVO }) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const updatedAt = formatListTime(changeRequest.updatedAt, locale);
  const riskHints = getChangeRequestRiskHints(changeRequest, messages);
  const statusLabel = changeRequestStatusLabel(changeRequest.status, messages);
  const message = getChangeRequestMessage(changeRequest);
  const submissionIdentity = resolveSubmissionIdentity(
    changeRequest.submittedByUser,
    changeRequest.submittedBy,
    changeRequest.sourceAttribution,
    messages,
  );
  const href = useHrefWithCurrentSearch(`/inbox/${changeRequest.id}`);

  return (
    <Link
      className="group relative grid min-h-14 items-center gap-2 py-2.5 pr-3 pl-5 transition-colors hover:bg-accent/25 md:grid-cols-[minmax(0,1fr)_220px]"
      href={href}
    >
      {/* 3px status rail on the left edge. In a queue this dense, scanning the
          left edge for the green/gold/red rhythm is far faster than reading the
          chip at the end of each row. Inset vertically so consecutive rows read
          as separate marks rather than one continuous stripe. */}
      <span
        aria-hidden="true"
        className={`absolute top-2 bottom-2 left-0 w-[3px] rounded-sm ${statusAccent(changeRequest.status)}`}
      />
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
            <span className="hidden shrink-0 rounded-md border border-review/35 bg-review/17 px-1.5 py-0.5 font-medium text-[11px] text-review-strong sm:inline-flex dark:text-review-soft">
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
          <SourceAttributionInline
            channelLabel={submissionIdentity.channelLabel}
            className="min-w-0 truncate"
            credentialLabel={submissionIdentity.credentialLabel}
            owner={submissionIdentity.ownerLabel}
            showChannel={false}
          />
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 text-muted-foreground text-xs md:justify-end">
        <span className="hidden min-w-0 truncate md:block">
          {getChangeRequestSummary(changeRequest, messages)}
        </span>
        <span
          className="shrink-0 font-mono text-[11px] transition-colors group-hover:text-foreground"
          data-testid="change-request-updated-at"
        >
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
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div
        className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5"
        data-dashboard-scroll="activity"
      >
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
          <div className="flex items-center justify-center py-4">
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
              disabled={listQuery.isFetchingNextPage}
              onClick={() => listQuery.fetchNextPage()}
              type="button"
            >
              {listQuery.isFetchingNextPage ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : null}
              <span>
                {listQuery.isFetchingNextPage ? messages.common.loading : messages.search.loadMore}
              </span>
              {!listQuery.isFetchingNextPage ? (
                <ChevronDown aria-hidden="true" className="size-3.5" />
              ) : null}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
