import type { ActivityItemVO, AuditEventVO } from "busabase-contract/types";
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

/**
 * Format ONE server-paginated activity descriptor into a renderable ActivityEvent
 * (title / body / href), applying i18n on the client. The server (activity.listPaged)
 * merges + paginates the four event sources; this only renders a single item, so
 * the whole change-request / record / audit tables never reach the browser.
 * Returns null for an operation whose parent CR didn't carry it (shouldn't happen).
 */
export const buildActivityEventFromItem = (
  item: ActivityItemVO,
  messages?: CoreI18nMessages,
): ActivityEvent | null => {
  if (item.kind === "change_request") {
    const changeRequest = item.changeRequest;
    return {
      body: `${getChangeRequestSummary(changeRequest, messages)} · ${getChangeRequestScopeName(changeRequest, messages)}`,
      href: `/inbox/${changeRequest.id}`,
      id: `changeRequest:${changeRequest.id}:updated`,
      timestamp: item.timestamp,
      title:
        changeRequest.status === "merged"
          ? fmt(messages?.activity.changeRequestMergedTitle ?? "Change request merged: {title}", {
              title: getChangeRequestTitle(changeRequest, messages),
            })
          : changeRequest.status === "approved"
            ? fmt(
                messages?.activity.changeRequestApprovedTitle ?? "Change request approved: {title}",
                { title: getChangeRequestTitle(changeRequest, messages) },
              )
            : fmt(messages?.activity.changeRequestOpenedTitle ?? "Change request opened: {title}", {
                title: getChangeRequestTitle(changeRequest, messages),
              }),
      tone: "change_request",
    };
  }

  if (item.kind === "operation") {
    const operation = item.changeRequest.operations.find((op) => op.id === item.operationId);
    if (!operation) return null;
    return {
      body: `${getOperationLabel(operation, messages)} · ${getOperationImpact(operation, messages)} · ${fmt(messages?.activity.commitRef ?? "commit {id}", { id: shortIdentifier(operation.headCommitId) })}`,
      href: `/inbox/${item.changeRequest.id}/${operation.id}`,
      id: `operation:${operation.id}`,
      timestamp: item.timestamp,
      title: getOperationTitle(operation, item.changeRequest.base, messages),
      tone: operation.status === "pending" ? "operation" : "commit",
    };
  }

  if (item.kind === "record") {
    const record = item.record;
    return {
      body: `${record.base.name} · ${fmt(messages?.activity.headCommit ?? "head commit {id}", { id: shortIdentifier(record.headCommitId) })}`,
      href: `/base/${record.base.slug}/${record.id}`,
      id: `record:${record.id}`,
      timestamp: item.timestamp,
      title:
        record.status === "archived"
          ? fmt(messages?.activity.recordArchivedTitle ?? "Record archived: {title}", {
              title: getRecordTitle(record, messages),
            })
          : fmt(messages?.activity.recordUpdatedTitle ?? "Record updated: {title}", {
              title: getRecordTitle(record, messages),
            }),
      tone: "record",
    };
  }

  const event = item.auditEvent;
  return {
    body: `${formatUserRefLabel(event.actor, event.actorId, messages)} · ${event.action}`,
    href: event.recordId
      ? `/base/${item.record?.base.slug ?? "unknown"}/${event.recordId}`
      : event.changeRequestId
        ? `/inbox/${event.changeRequestId}`
        : "/activity",
    id: `audit:${event.id}`,
    timestamp: item.timestamp,
    title: messages ? getLocalizedAuditEventTitle(event, messages) : getAuditEventTitle(event),
    tone: "audit",
  };
};
