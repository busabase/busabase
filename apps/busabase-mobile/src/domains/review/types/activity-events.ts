import type {
  ActivityItemVO,
  AuditEventVO,
  ChangeRequestVO,
  RecordVO,
} from "busabase-contract/types";
import {
  getChangeRequestScopeName,
  getChangeRequestSummary,
  getChangeRequestTitle,
  getOperationImpact,
  getOperationLabel,
  getOperationTitle,
  getRecordTitle,
} from "busabase-core/dashboard/change-request";

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
    | { kind: "operation"; changeRequestId: string; operationId: string }
    | { kind: "record"; id: string }
    | { kind: "none" };
}

const shortId = (value: string | null | undefined) => value?.slice(0, 10) ?? "none";

const auditActionLabel: Partial<Record<AuditEventVO["action"], string>> = {
  "asset.deleted": "Asset deleted",
  "base.created": "Base created",
  "change_request.created": "Change request opened",
  "change_request.deleted": "Delete request opened",
  "change_request.merged": "Change request merged",
  "change_request.reviewed": "Change request reviewed",
  "change_request.updated": "Update request opened",
  "doc.created": "Doc created",
  "doc.updated": "Doc updated",
  "drive.created": "Drive created",
  "field.created": "Field created",
  "node.purged": "Node permanently deleted",
  "record.viewed": "Record viewed",
  "skill.created": "Skill created",
};

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

/** Convert one server-paginated descriptor into the mobile timeline shape. */
export function buildActivityEventFromItem(item: ActivityItemVO): ActivityEvent | null {
  if (item.kind === "change_request") {
    const changeRequest = item.changeRequest;
    return {
      id: `changeRequest:${changeRequest.id}`,
      title:
        changeRequest.status === "merged"
          ? `Change request merged: ${getChangeRequestTitle(changeRequest)}`
          : changeRequest.status === "approved"
            ? `Change request approved: ${getChangeRequestTitle(changeRequest)}`
            : `Change request opened: ${getChangeRequestTitle(changeRequest)}`,
      body: `${getChangeRequestSummary(changeRequest)} · ${getChangeRequestScopeName(changeRequest)}`,
      tone: "change_request",
      timestamp: item.timestamp,
      target: { kind: "change-request", id: changeRequest.id },
    };
  }

  if (item.kind === "operation") {
    const operation = item.changeRequest.operations.find(({ id }) => id === item.operationId);
    if (!operation) return null;
    return {
      id: `operation:${operation.id}`,
      title: getOperationTitle(operation, item.changeRequest.base),
      body: `${getOperationLabel(operation)} · ${getOperationImpact(operation)}`,
      tone: operation.status === "pending" ? "operation" : "commit",
      timestamp: item.timestamp,
      target: {
        kind: "operation",
        changeRequestId: item.changeRequest.id,
        operationId: operation.id,
      },
    };
  }

  if (item.kind === "record") {
    const record = item.record;
    return {
      id: `record:${record.id}`,
      title:
        record.status === "archived"
          ? `Record archived: ${getRecordTitle(record)}`
          : `Record updated: ${getRecordTitle(record)}`,
      body: `${record.base.name} · commit ${shortId(record.headCommitId)}`,
      tone: "record",
      timestamp: item.timestamp,
      target: { kind: "record", id: record.id },
    };
  }

  const event = item.auditEvent;
  return {
    id: `audit:${event.id}`,
    title: getAuditEventTitle(event),
    body: `${event.actorId} · ${auditActionLabel[event.action] ?? event.action}`,
    tone: "audit",
    timestamp: item.timestamp,
    target: event.recordId
      ? { kind: "record", id: event.recordId }
      : event.changeRequestId
        ? { kind: "change-request", id: event.changeRequestId }
        : { kind: "none" },
  };
}

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
      body: `${getChangeRequestSummary(changeRequest)} · ${getChangeRequestScopeName(changeRequest)}`,
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
      body: `${event.actorId} · ${auditActionLabel[event.action] ?? event.action}`,
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
