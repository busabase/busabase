import type { AuditEventVO, ChangeRequestVO, RecordVO } from "busabase-contract/types";
import {
  getChangeRequestScopeName,
  getChangeRequestTitle,
  getOperationSummary,
  getRecordTitle,
} from "./busabase-display";

export type ActivityTone = "audit" | "change_request" | "operation" | "commit" | "record";

export interface ActivityEvent {
  id: string;
  title: string;
  body: string;
  tone: ActivityTone;
  timestamp: string;
  /** Deep-link target inside the app (expo-router pathname + params). */
  target:
    | { kind: "change-request"; id: string }
    | { kind: "record"; id: string }
    | { kind: "none" };
}

const shortId = (value: string | null | undefined) => value?.slice(0, 10) ?? "none";

const getAuditEventTitle = (event: AuditEventVO): string => {
  switch (event.action) {
    case "record.viewed":
      return `Record viewed: ${String(event.metadata.title ?? shortId(event.recordId))}`;
    case "change_request.created":
      return "Create change request opened";
    case "change_request.updated":
      return "Update change request opened";
    case "change_request.deleted":
      return "Delete change request opened";
    case "change_request.reviewed":
      return `Change request reviewed: ${String(event.metadata.verdict ?? "reviewed")}`;
    default:
      return "Change request merged";
  }
};

/**
 * Mirrors the web dashboard's buildActivityEvents: merge change request, record,
 * and audit events into one newest-first timeline with deep-link targets.
 */
export function buildActivityEvents(
  changeRequests: ChangeRequestVO[],
  records: RecordVO[],
  auditEvents: AuditEventVO[],
): ActivityEvent[] {
  const changeRequestEvents = changeRequests.map(
    (changeRequest): ActivityEvent => ({
      id: `changeRequest:${changeRequest.id}`,
      title:
        changeRequest.status === "merged"
          ? `Change request merged: ${getChangeRequestTitle(changeRequest)}`
          : changeRequest.status === "approved"
            ? `Change request approved: ${getChangeRequestTitle(changeRequest)}`
            : `Change request opened: ${getChangeRequestTitle(changeRequest)}`,
      body: `${getOperationSummary(changeRequest)} · ${getChangeRequestScopeName(changeRequest)}`,
      tone: "change_request",
      timestamp: changeRequest.updatedAt,
      target: { kind: "change-request", id: changeRequest.id },
    }),
  );

  const recordEvents = records.map(
    (record): ActivityEvent => ({
      id: `record:${record.id}`,
      title:
        record.status === "archived"
          ? `Record archived: ${getRecordTitle(record)}`
          : `Record updated: ${getRecordTitle(record)}`,
      body: `${record.base.name} · commit ${shortId(record.headCommitId)}`,
      tone: "record",
      timestamp: record.updatedAt,
      target: { kind: "record", id: record.id },
    }),
  );

  const auditActivityEvents = auditEvents.map(
    (event): ActivityEvent => ({
      id: `audit:${event.id}`,
      title: getAuditEventTitle(event),
      body: `${event.actorId} · ${event.action}`,
      tone: "audit",
      timestamp: event.createdAt,
      target: event.recordId
        ? { kind: "record", id: event.recordId }
        : event.changeRequestId
          ? { kind: "change-request", id: event.changeRequestId }
          : { kind: "none" },
    }),
  );

  return [...changeRequestEvents, ...recordEvents, ...auditActivityEvents].sort(
    (first, second) => new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime(),
  );
}
