import type { AuditEventVO, ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type ReactNode, useMemo } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
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
import { ActivityRow, buildActivityEvents } from "./activity";
import { EmptyState } from "./primitives";

function BusabaseList({
  empty,
  groups,
  toolbar,
}: {
  empty: ReactNode;
  groups: BusabaseListGroup[];
  toolbar?: ReactNode;
}) {
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
        {visibleGroups.length > 0 ? (
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
    </section>
  );
}

export function InboxView({
  activeView,
  changeRequests,
  currentUserId,
  emptyGuide,
}: {
  activeView: InboxViewKey;
  changeRequests: ChangeRequestVO[];
  currentUserId?: string | null;
  emptyGuide?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <InboxList
        activeView={activeView}
        changeRequests={changeRequests}
        currentUserId={currentUserId}
        emptyGuide={emptyGuide}
      />
    </div>
  );
}

function InboxList({
  activeView,
  changeRequests,
  currentUserId,
  emptyGuide,
}: {
  activeView: InboxViewKey;
  changeRequests: ChangeRequestVO[];
  currentUserId?: string | null;
  emptyGuide?: ReactNode;
}) {
  const messages = useCoreI18n();
  const reviewChangeRequests = changeRequests.filter(
    (changeRequest) => changeRequest.status === "in_review",
  );
  const changesRequestedChangeRequests = changeRequests.filter(
    (changeRequest) => changeRequest.status === "changes_requested",
  );
  const createdChangeRequests = changeRequests.filter((changeRequest) =>
    currentUserId
      ? changeRequest.submittedBy === currentUserId
      : changeRequest.submittedBy === "local-editor",
  );
  const approvedChangeRequests = changeRequests.filter(
    (changeRequest) => changeRequest.status === "approved",
  );
  const mergedChangeRequests = changeRequests.filter(
    (changeRequest) => changeRequest.status === "merged",
  );
  const rejectedChangeRequests = changeRequests.filter(
    (changeRequest) => changeRequest.status === "rejected" || changeRequest.status === "abandoned",
  );
  const inboxCounts: Record<InboxViewKey, number> = {
    approved: approvedChangeRequests.length,
    changes: changesRequestedChangeRequests.length,
    created: createdChangeRequests.length,
    merged: mergedChangeRequests.length,
    rejected: rejectedChangeRequests.length,
    review: reviewChangeRequests.length,
  };
  const activeChangeRequests =
    activeView === "created"
      ? createdChangeRequests
      : activeView === "changes"
        ? changesRequestedChangeRequests
        : activeView === "approved"
          ? approvedChangeRequests
          : activeView === "merged"
            ? mergedChangeRequests
            : activeView === "rejected"
              ? rejectedChangeRequests
              : reviewChangeRequests;
  const isOpenStatus = (status: ChangeRequestVO["status"]) =>
    status === "in_review" || status === "changes_requested" || status === "approved";
  const openCreatedChangeRequests = createdChangeRequests.filter((changeRequest) =>
    isOpenStatus(changeRequest.status),
  );
  const closedCreatedChangeRequests = createdChangeRequests.filter(
    (changeRequest) => !isOpenStatus(changeRequest.status),
  );
  const groups =
    activeView === "created"
      ? [
          {
            count: openCreatedChangeRequests.length,
            items: openCreatedChangeRequests.map((changeRequest) => (
              <ReviewChangeRequestRow changeRequest={changeRequest} key={changeRequest.id} />
            )),
            title: messages.inbox.openChangeRequests,
          },
          {
            count: closedCreatedChangeRequests.length,
            items: closedCreatedChangeRequests.map((changeRequest) => (
              <ReviewChangeRequestRow changeRequest={changeRequest} key={changeRequest.id} />
            )),
            title: messages.inbox.closedChangeRequests,
          },
        ]
      : [
          {
            count: activeChangeRequests.length,
            items: activeChangeRequests.map((changeRequest) => (
              <ReviewChangeRequestRow changeRequest={changeRequest} key={changeRequest.id} />
            )),
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
      toolbar={<BusabaseListToolbar activeView={activeView} counts={inboxCounts} />}
    />
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

export function ActivityView({
  auditEvents,
  changeRequests,
  emptyGuide,
  records,
}: {
  auditEvents: AuditEventVO[];
  changeRequests: ChangeRequestVO[];
  emptyGuide?: ReactNode;
  records: RecordVO[];
}) {
  const messages = useCoreI18n();
  const events = useMemo(
    () => buildActivityEvents(changeRequests, records, auditEvents, messages),
    [auditEvents, changeRequests, records, messages],
  );
  const changeRequestCount = changeRequests.length;
  const operationCount = changeRequests.reduce(
    (count, changeRequest) => count + changeRequest.operations.length,
    0,
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recentEvents = events.filter((event) => new Date(event.timestamp) >= today);
  const earlierEvents = events.filter((event) => new Date(event.timestamp) < today);

  return (
    <BusabaseList
      empty={
        <EmptyState
          title={messages.activity.noActivityTitle}
          body={messages.activity.noActivityBody}
          action={emptyGuide}
        />
      }
      groups={[
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
      ].filter((group) => group.count > 0)}
      toolbar={
        <>
          <div className="font-medium text-sm">{messages.activity.workspaceActivity}</div>
          <div className="text-muted-foreground text-xs">
            {fmt(messages.activity.activityStats, {
              auditEvents: auditEvents.length,
              changeRequests: changeRequestCount,
              operations: operationCount,
              records: records.length,
            })}
          </div>
        </>
      }
    />
  );
}
