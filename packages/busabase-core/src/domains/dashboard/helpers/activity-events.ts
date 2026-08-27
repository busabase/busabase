import type {
  ActivityItemVO,
  AuditEventVO,
  SourceAttributionVO,
  UserRefVO,
} from "busabase-contract/types";
import { fmt } from "../../../i18n/fmt";
import type { CoreI18nMessages } from "../../../i18n/messages";
import {
  getChangeRequestScopeName,
  getChangeRequestSummary,
  getChangeRequestTitle,
  getOperationImpact,
  getOperationLabel,
  getOperationTitle,
  getRecordTitle,
} from "./change-request";
import { formatOpaqueUserId, formatUserRefLabel, shortIdentifier } from "./format";
import { resolveSubmissionIdentity } from "./source-attribution";

export type ActivityEventTone = "audit" | "change_request" | "operation" | "commit" | "record";

export interface ActivityEvent {
  id: string;
  actorName: string;
  actorImage?: string | null;
  actionLabel: string;
  provenance?: ActivityProvenance;
  title: string;
  body: string;
  href: string;
  sourceLabel?: string;
  timestamp: string;
  tone: ActivityEventTone;
}

export interface ActivityProvenance {
  byline: string;
  channelLabel?: string;
  credentialLabel?: string;
  ownerLabel?: string;
}

const UPPERCASE_ACTOR_TOKENS = new Set(["ai", "api", "cms", "crm", "seo", "ui", "ux"]);

const titleCaseActorToken = (value: string) => {
  const lower = value.toLowerCase();
  if (UPPERCASE_ACTOR_TOKENS.has(lower)) {
    return lower.toUpperCase();
  }
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}` : "";
};

const humanizeActivityActorId = (fallbackId: string | null | undefined) => {
  const id = fallbackId?.trim();
  if (!id || id.length > 48 || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(id)) {
    return null;
  }
  if (!/^[a-z][a-z0-9._-]*$/i.test(id)) {
    return null;
  }
  const parts = id
    .split(/[._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 4 || parts.some((part) => part.length > 16)) {
    return null;
  }
  return parts.map(titleCaseActorToken).join(" ");
};

const getActor = (
  user: UserRefVO | null | undefined,
  fallbackId: string | null | undefined,
  messages?: CoreI18nMessages,
) => ({
  image: user?.image ?? null,
  name: user
    ? formatUserRefLabel(user, fallbackId, messages)
    : (humanizeActivityActorId(fallbackId) ?? formatOpaqueUserId(fallbackId, messages)),
});

const buildActivityIdentity = (
  user: UserRefVO | null | undefined,
  fallbackId: string | null | undefined,
  sourceAttribution: SourceAttributionVO | null | undefined,
  messages?: CoreI18nMessages,
) => {
  const actor = getActor(user, fallbackId, messages);
  const identity = resolveSubmissionIdentity(user, fallbackId, sourceAttribution, messages);
  return {
    image: actor.image,
    name: identity.ownerLabel,
    provenance: identity.activityByline
      ? {
          byline: identity.activityByline,
          channelLabel: identity.channelLabel ?? undefined,
          credentialLabel: identity.credentialLabel ?? undefined,
        }
      : undefined,
  };
};

const getChangeRequestActionLabel = (
  item: Extract<ActivityItemVO, { kind: "change_request" }>,
  messages?: CoreI18nMessages,
) => {
  if (item.changeRequest.status === "merged") {
    return messages?.activity.mergedChangeRequest ?? "merged a change request";
  }
  if (item.changeRequest.status === "approved") {
    return messages?.activity.approvedChangeRequest ?? "approved a change request";
  }
  return messages?.activity.openedChangeRequest ?? "opened a change request";
};

const getAuditActionLabel = (event: AuditEventVO, messages?: CoreI18nMessages) => {
  if (event.action === "record.viewed") {
    return messages?.activity.viewedRecord ?? "viewed a record";
  }
  if (event.action === "change_request.reviewed") {
    return messages?.activity.reviewedChangeRequest ?? "reviewed a change request";
  }
  if (event.action === "change_request.merged") {
    return messages?.activity.mergedChangeRequest ?? "merged a change request";
  }
  return messages?.activity.recordedAuditEvent ?? "recorded an audit event";
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
    const actor = buildActivityIdentity(
      changeRequest.submittedByUser,
      changeRequest.submittedBy,
      changeRequest.sourceAttribution,
      messages,
    );
    const scopeName = getChangeRequestScopeName(changeRequest, messages);
    const title = getChangeRequestTitle(changeRequest, messages);
    return {
      actionLabel: getChangeRequestActionLabel(item, messages),
      actorImage: actor.image,
      actorName: actor.name,
      body: getChangeRequestSummary(changeRequest, messages),
      href: `/inbox/${changeRequest.id}`,
      id: `changeRequest:${changeRequest.id}:updated`,
      provenance: actor.provenance,
      sourceLabel: scopeName,
      timestamp: item.timestamp,
      title,
      tone: "change_request",
    };
  }

  if (item.kind === "operation") {
    const operation = item.changeRequest.operations.find((op) => op.id === item.operationId);
    if (!operation) return null;
    const actor = getActor(
      operation.headCommit.authorUser ?? item.changeRequest.submittedByUser,
      operation.headCommit.author ?? item.changeRequest.submittedBy,
      messages,
    );
    const identity = buildActivityIdentity(
      operation.headCommit.authorUser ?? item.changeRequest.submittedByUser,
      operation.headCommit.author ?? item.changeRequest.submittedBy,
      item.changeRequest.sourceAttribution,
      messages,
    );
    const sourceLabel = fmt(messages?.activity.commitRef ?? "commit {id}", {
      id: shortIdentifier(operation.headCommitId),
    });
    return {
      actionLabel:
        operation.status === "pending"
          ? (messages?.activity.proposedOperation ?? "proposed an operation")
          : (messages?.activity.committedOperation ?? "committed an operation"),
      actorImage: identity.image ?? actor.image,
      actorName: identity.name,
      body: `${getOperationLabel(operation, messages)} · ${getOperationImpact(operation, messages)}`,
      href: `/inbox/${item.changeRequest.id}/${operation.id}`,
      id: `operation:${operation.id}`,
      provenance: identity.provenance,
      sourceLabel,
      timestamp: item.timestamp,
      title: getOperationTitle(operation, item.changeRequest.base, messages),
      tone: operation.status === "pending" ? "operation" : "commit",
    };
  }

  if (item.kind === "record") {
    const record = item.record;
    const actor = buildActivityIdentity(
      record.headCommit.authorUser ?? record.createdByUser,
      record.headCommit.author ?? record.createdBy,
      null,
      messages,
    );
    return {
      actionLabel:
        record.status === "archived"
          ? (messages?.activity.archivedRecord ?? "archived a record")
          : (messages?.activity.updatedRecord ?? "updated a record"),
      actorImage: actor.image,
      actorName: actor.name,
      body: fmt(messages?.activity.headCommit ?? "head commit {id}", {
        id: shortIdentifier(record.headCommitId),
      }),
      href: `/base/${record.base.slug}/${record.id}`,
      id: `record:${record.id}`,
      provenance: actor.provenance,
      sourceLabel: record.base.name,
      timestamp: item.timestamp,
      title: getRecordTitle(record, messages),
      tone: "record",
    };
  }

  const event = item.auditEvent;
  const actor = buildActivityIdentity(
    event.actor,
    event.actorId,
    event.sourceAttribution,
    messages,
  );
  return {
    actionLabel: getAuditActionLabel(event, messages),
    actorImage: actor.image,
    actorName: actor.name,
    body: event.action,
    href: event.recordId
      ? `/base/${item.record?.base.slug ?? "unknown"}/${event.recordId}`
      : event.changeRequestId
        ? `/inbox/${event.changeRequestId}`
        : "/activity",
    id: `audit:${event.id}`,
    provenance: actor.provenance,
    sourceLabel: event.recordId
      ? item.record?.base.name
      : event.changeRequestId
        ? (messages?.activity.changeRequest ?? "change request")
        : (messages?.activity.audit ?? "audit"),
    timestamp: item.timestamp,
    title:
      event.action === "record.viewed"
        ? String(event.metadata.title ?? shortIdentifier(event.recordId))
        : messages
          ? getLocalizedAuditEventTitle(event, messages)
          : getAuditEventTitle(event),
    tone: "audit",
  };
};
