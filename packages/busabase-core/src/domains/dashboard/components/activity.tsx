import type { AuditEventVO, ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { ChevronRight } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
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

export const buildActivityEvents = (
  changeRequests: ChangeRequestVO[],
  records: RecordVO[],
  auditEvents: AuditEventVO[],
) => {
  const changeRequestEvents = changeRequests.flatMap((changeRequest): ActivityEvent[] => {
    const baseEvents: ActivityEvent[] = [
      {
        body: `${getChangeRequestSummary(changeRequest)} · ${getChangeRequestScopeName(changeRequest)}`,
        href: `/inbox/${changeRequest.id}`,
        id: `changeRequest:${changeRequest.id}:updated`,
        timestamp: changeRequest.updatedAt,
        title:
          changeRequest.status === "merged"
            ? `Change request merged: ${getChangeRequestTitle(changeRequest)}`
            : changeRequest.status === "approved"
              ? `Change request approved: ${getChangeRequestTitle(changeRequest)}`
              : `Change request opened: ${getChangeRequestTitle(changeRequest)}`,
        tone: "change_request",
      },
    ];

    const operationEvents = changeRequest.operations.map(
      (operation): ActivityEvent => ({
        body: `${operationMeta[operation.operation].label} · ${getOperationImpact(operation)} · commit ${shortIdentifier(operation.headCommitId)}`,
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
      body: `${record.base.name} · head commit ${shortIdentifier(record.headCommitId)}`,
      href: `/base/${record.base.slug}/${record.id}`,
      id: `record:${record.id}`,
      timestamp: record.updatedAt,
      title:
        record.status === "archived"
          ? `Record archived: ${getRecordTitle(record)}`
          : `Record updated: ${getRecordTitle(record)}`,
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
      title: getAuditEventTitle(event),
      tone: "audit",
    }),
  );

  return [...changeRequestEvents, ...recordEvents, ...auditActivityEvents].sort(
    (first, second) => new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime(),
  );
};

export function ActivityRow({ event }: { event: ActivityEvent }) {
  return (
    <Link
      className="group grid min-h-16 items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-accent/25 md:grid-cols-[116px_minmax(0,1fr)_120px]"
      href={event.href}
    >
      <div>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 font-medium text-xs capitalize ${activityTone[event.tone]}`}
        >
          {event.tone}
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
