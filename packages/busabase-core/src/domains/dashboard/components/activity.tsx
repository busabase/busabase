import type { AuditEventVO, ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { ChevronRight } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type CoreI18nMessages, fmt, useCoreI18n } from "../../../i18n";
import {
  getChangeRequestScopeName,
  getChangeRequestSummary,
  getChangeRequestTitle,
  getOperationImpact,
  getOperationTitle,
  getRecordTitle,
  operationMeta,
} from "../helpers/change-request";
import { formatListTime, shortIdentifier } from "../helpers/format";

export type ActivityEventTone = "audit" | "change_request" | "operation" | "commit" | "record";

export interface ActivityEvent {
  id: string;
  title: string;
  body: string;
  href: string;
  timestamp: string;
  tone: ActivityEventTone;
}

export const activityTone: Record<ActivityEventTone, string> = {
  audit: "border-slate-200 bg-slate-50 text-slate-700",
  commit: "border-sky-200 bg-sky-50 text-sky-800",
  change_request: "border-amber-200 bg-amber-50 text-amber-900",
  operation: "border-violet-200 bg-violet-50 text-violet-800",
  record: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export const getAuditEventTitle = (event: AuditEventVO) => {
  if (event.action === "record.viewed") {
    return `Record viewed: ${String(event.metadata.title ?? shortIdentifier(event.recordId))}`;
  }
  if (event.action === "change_request.created") {
    return "Create change request opened";
  }
  if (event.action === "change_request.updated") {
    return "Update change request opened";
  }
  if (event.action === "change_request.deleted") {
    return "Delete change request opened";
  }
  if (event.action === "change_request.reviewed") {
    return `Change request reviewed: ${String(event.metadata.verdict ?? "reviewed")}`;
  }
  return "Change request merged";
};

export const getLocalizedAuditEventTitle = (event: AuditEventVO, messages: CoreI18nMessages) => {
  if (event.action === "record.viewed") {
    return fmt(messages.activity.recordViewed, {
      title: String(event.metadata.title ?? shortIdentifier(event.recordId)),
    });
  }
  if (event.action === "change_request.created") {
    return messages.activity.createChangeRequestOpened;
  }
  if (event.action === "change_request.updated") {
    return messages.activity.updateChangeRequestOpened;
  }
  if (event.action === "change_request.deleted") {
    return messages.activity.deleteChangeRequestOpened;
  }
  if (event.action === "change_request.reviewed") {
    return fmt(messages.activity.changeRequestReviewed, {
      verdict: String(event.metadata.verdict ?? "reviewed"),
    });
  }
  return messages.activity.changeRequestMerged;
};

export const buildActivityEvents = (
  changeRequests: ChangeRequestVO[],
  records: RecordVO[],
  auditEvents: AuditEventVO[],
  messages?: CoreI18nMessages,
) => {
  const changeRequestEvents = changeRequests.flatMap((changeRequest): ActivityEvent[] => {
    const baseEvents: ActivityEvent[] = [
      {
        body: `${getChangeRequestSummary(changeRequest, messages)} · ${getChangeRequestScopeName(changeRequest)}`,
        href: `/inbox/${changeRequest.id}`,
        id: `changeRequest:${changeRequest.id}:updated`,
        timestamp: changeRequest.updatedAt,
        title:
          changeRequest.status === "merged"
            ? fmt(messages?.activity.changeRequestMergedTitle ?? "Change request merged: {title}", {
                title: getChangeRequestTitle(changeRequest, messages),
              })
            : changeRequest.status === "approved"
              ? fmt(
                  messages?.activity.changeRequestApprovedTitle ??
                    "Change request approved: {title}",
                  { title: getChangeRequestTitle(changeRequest, messages) },
                )
              : fmt(
                  messages?.activity.changeRequestOpenedTitle ?? "Change request opened: {title}",
                  {
                    title: getChangeRequestTitle(changeRequest, messages),
                  },
                ),
        tone: "change_request",
      },
    ];

    const operationEvents = changeRequest.operations.map(
      (operation): ActivityEvent => ({
        body: `${operationMeta[operation.operation].label} · ${getOperationImpact(operation)} · ${fmt(messages?.activity.commitRef ?? "commit {id}", { id: shortIdentifier(operation.headCommitId) })}`,
        href: `/inbox/${changeRequest.id}/${operation.id}`,
        id: `operation:${operation.id}`,
        timestamp: operation.updatedAt,
        title: getOperationTitle(operation, changeRequest.base),
        tone: operation.status === "pending" ? "operation" : "commit",
      }),
    );

    return [...baseEvents, ...operationEvents];
  });

  const recordEvents = records.map(
    (record): ActivityEvent => ({
      body: `${record.base.name} · ${fmt(messages?.activity.headCommit ?? "head commit {id}", { id: shortIdentifier(record.headCommitId) })}`,
      href: `/base/${record.base.slug}/${record.id}`,
      id: `record:${record.id}`,
      timestamp: record.updatedAt,
      title:
        record.status === "archived"
          ? fmt(messages?.activity.recordArchivedTitle ?? "Record archived: {title}", {
              title: getRecordTitle(record),
            })
          : fmt(messages?.activity.recordUpdatedTitle ?? "Record updated: {title}", {
              title: getRecordTitle(record),
            }),
      tone: "record",
    }),
  );

  const auditActivityEvents = auditEvents.map(
    (event): ActivityEvent => ({
      body: `${event.actorId} · ${event.action}`,
      href: event.recordId
        ? `/base/${records.find((record) => record.id === event.recordId)?.base.slug ?? "unknown"}/${event.recordId}`
        : event.changeRequestId
          ? `/inbox/${event.changeRequestId}`
          : "/activity",
      id: `audit:${event.id}`,
      timestamp: event.createdAt,
      title: messages ? getLocalizedAuditEventTitle(event, messages) : getAuditEventTitle(event),
      tone: "audit",
    }),
  );

  return [...changeRequestEvents, ...recordEvents, ...auditActivityEvents].sort(
    (first, second) => new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime(),
  );
};

export function ActivityRow({ event }: { event: ActivityEvent }) {
  const messages = useCoreI18n();
  const toneLabel: Record<ActivityEventTone, string> = {
    audit: messages.activity.audit,
    change_request: messages.activity.changeRequest,
    commit: messages.activity.commit,
    operation: messages.activity.operation,
    record: messages.activity.record,
  };

  return (
    <Link
      className="group grid min-h-16 items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-accent/25 md:grid-cols-[116px_minmax(0,1fr)_120px]"
      href={event.href}
    >
      <div>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 font-medium text-xs capitalize ${activityTone[event.tone]}`}
        >
          {toneLabel[event.tone]}
        </span>
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold text-sm leading-5">{event.title}</div>
        <div className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{event.body}</div>
      </div>
      <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs md:justify-end">
        <span className="font-mono">{formatListTime(event.timestamp)}</span>
        <ChevronRight
          className="shrink-0 transition-colors group-hover:text-foreground"
          size={14}
        />
      </div>
    </Link>
  );
}
