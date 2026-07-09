import type { AuditEventVO, ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { type CoreI18nMessages, fmt } from "../../../i18n";
import {
  getChangeRequestScopeName,
  getChangeRequestSummary,
  getChangeRequestTitle,
  getOperationImpact,
  getOperationLabel,
  getOperationTitle,
  getRecordTitle,
} from "./change-request";
import { formatUserRefLabel, shortIdentifier } from "./format";

export type ActivityEventTone = "audit" | "change_request" | "operation" | "commit" | "record";

export interface ActivityEvent {
  id: string;
  title: string;
  body: string;
  href: string;
  timestamp: string;
  tone: ActivityEventTone;
}

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
        body: `${getChangeRequestSummary(changeRequest, messages)} · ${getChangeRequestScopeName(changeRequest, messages)}`,
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
        body: `${getOperationLabel(operation, messages)} · ${getOperationImpact(operation, messages)} · ${fmt(messages?.activity.commitRef ?? "commit {id}", { id: shortIdentifier(operation.headCommitId) })}`,
        href: `/inbox/${changeRequest.id}/${operation.id}`,
        id: `operation:${operation.id}`,
        timestamp: operation.updatedAt,
        title: getOperationTitle(operation, changeRequest.base, messages),
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
              title: getRecordTitle(record, messages),
            })
          : fmt(messages?.activity.recordUpdatedTitle ?? "Record updated: {title}", {
              title: getRecordTitle(record, messages),
            }),
      tone: "record",
    }),
  );

  // O(1) record lookup instead of records.find() per audit event (was O(audit × records)).
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const auditActivityEvents = auditEvents.map(
    (event): ActivityEvent => ({
      body: `${formatUserRefLabel(event.actor, event.actorId, messages)} · ${event.action}`,
      href: event.recordId
        ? `/base/${recordsById.get(event.recordId)?.base.slug ?? "unknown"}/${event.recordId}`
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
