import { createHash } from "node:crypto";
import type { EmailMessage, ReceivedEmail, SentEmail } from "./types.js";

/** A small public API surface satisfied by busabase-sdk's raw client or Busabase wrapper. */
export interface EmailStoreClient {
  records: {
    search(input: {
      baseId: string;
      fieldSlug: string;
      valueText: string;
      limit?: number;
    }): Promise<Array<{ id: string }>>;
  };
  bases: {
    createChangeRequest(input: {
      baseId: string;
      fields: Record<string, unknown>;
      message?: string;
      submittedBy?: string;
      idempotencyKey?: string;
    }): Promise<{ id: string; materialized: boolean; status?: string }>;
  };
}

export interface EmailStoreFields {
  /** A text field used for exact duplicate lookup. */
  externalKey: string;
  title?: string;
  type?: string;
  date?: string;
  /** Text/email field containing the peer address. */
  contact?: string;
  /** Optional relation field pointing to an existing lead/contact record. */
  contactRelation?: string;
  campaign?: string;
  messageId?: string;
  providerMessageId?: string;
  provider?: string;
  account?: string;
  summary?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  accepted?: string;
  rejected?: string;
}

export interface EmailRecordContext {
  /** Required for incoming messages without an RFC Message-ID; use mailbox + UIDVALIDITY + UID. */
  externalKey?: string;
  contactId?: string;
  campaignId?: string;
  date?: string;
}

export interface EmailRecordResult {
  status: "applied" | "pending" | "duplicate";
  externalKey: string;
  recordId?: string;
  changeRequestId?: string;
}

export interface BusabaseEmailStoreOptions {
  client: EmailStoreClient;
  baseId: string;
  fields: EmailStoreFields;
  values?: Partial<Record<"sent" | ReceivedEmail["kind"], string>>;
  campaignId?: string;
  /** Stable account/mailbox namespace; use this when several inboxes share a Base. */
  accountKey?: string;
  /** Keep stable across workers/restarts: server idempotency is scoped to base + submitter. */
  submittedBy?: string;
}

const stableKey = (direction: string, identity: string) =>
  `email:${direction}:${createHash("sha256").update(identity).digest("hex")}`;

/**
 * Records email events through permission-aware Change Requests. No approval/merge calls.
 * Exact lookups prevent duplicate materialized rows; the server idempotencyKey also protects
 * retries and pending requests on supporting Busabase servers. Older servers that ignore
 * idempotencyKey cannot guarantee concurrent deduplication: serialize writers there.
 */
export const createBusabaseEmailStore = (options: BusabaseEmailStoreOptions) => {
  const { client, baseId, fields: mapping } = options;
  if (!baseId.trim() || !mapping.externalKey.trim()) {
    throw new Error("baseId and an externalKey field mapping are required");
  }
  const slugs = Object.values(mapping).filter((slug): slug is string => slug !== undefined);
  if (slugs.some((slug) => !slug.trim()) || new Set(slugs).size !== slugs.length) {
    throw new Error("Email field mappings must be nonempty and distinct");
  }
  const inFlight = new Map<string, Promise<EmailRecordResult>>();

  const persist = async (
    externalKey: string,
    values: Partial<Record<keyof EmailStoreFields, unknown>>,
  ): Promise<EmailRecordResult> => {
    const existing = await client.records.search({
      baseId,
      fieldSlug: mapping.externalKey,
      valueText: externalKey,
      limit: 1,
    });
    if (existing[0]) {
      return { status: "duplicate", externalKey, recordId: existing[0].id };
    }
    const fields: Record<string, unknown> = { [mapping.externalKey]: externalKey };
    for (const [key, value] of Object.entries(values)) {
      const slug = mapping[key as keyof EmailStoreFields];
      if (slug && value !== undefined && value !== null) fields[slug] = value;
    }
    const response = await client.bases.createChangeRequest({
      baseId,
      fields,
      message: `Record email event — ${String(values.title ?? externalKey)}`,
      submittedBy: options.submittedBy ?? "busabase-email-sdk",
      idempotencyKey: externalKey,
    });
    if (response.materialized) {
      return { status: "applied", externalKey, recordId: response.id };
    }
    if (response.status === "merged") {
      return { status: "applied", externalKey, changeRequestId: response.id };
    }
    // A rejected/closed proposal is not a durable accepted event. Never checkpoint it.
    if (
      response.status !== "in_review" &&
      response.status !== "approved" &&
      response.status !== "changes_requested"
    ) {
      throw new Error(`Email Change Request ${response.id} is not pending: ${response.status}`);
    }
    return { status: "pending", externalKey, changeRequestId: response.id };
  };

  const record = (
    externalKey: string,
    values: Partial<Record<keyof EmailStoreFields, unknown>>,
  ): Promise<EmailRecordResult> => {
    if (!externalKey.trim()) throw new Error("Email externalKey must not be empty");
    const active = inFlight.get(externalKey);
    if (active) return active;
    const task = persist(externalKey, values).finally(() => inFlight.delete(externalKey));
    inFlight.set(externalKey, task);
    return task;
  };

  const relations = (context: EmailRecordContext) => ({
    account: options.accountKey,
    contactRelation: context.contactId ? [context.contactId] : undefined,
    campaign:
      (context.campaignId ?? options.campaignId)
        ? [context.campaignId ?? options.campaignId]
        : undefined,
  });

  return {
    recordSent: (message: EmailMessage, result: SentEmail, context: EmailRecordContext = {}) => {
      if (result.accepted.length === 0) {
        throw new Error("Cannot record a sent email without any accepted recipients");
      }
      const identity = result.messageId || result.providerMessageId;
      if (!context.externalKey && !identity)
        throw new Error("Sent email requires a stable identifier");
      return record(
        context.externalKey ??
          stableKey("sent", `${options.accountKey ?? ""}:${result.provider}:${identity}`),
        {
          ...relations(context),
          title: message.subject,
          type: options.values?.sent ?? "sent",
          date: context.date ?? new Date().toISOString(),
          messageId: result.messageId,
          providerMessageId: result.providerMessageId,
          provider: result.provider,
          summary: `${message.text ?? message.markdown ?? message.html ?? ""}${
            result.rejected.length
              ? `\n\nSubmission accepted: ${result.accepted.join(", ")}\nSubmission rejected: ${result.rejected.join(", ")}`
              : ""
          }`,
          contact: result.accepted.join(", "),
          from: message.from,
          to: Array.isArray(message.to) ? message.to.join(", ") : message.to,
          cc: Array.isArray(message.cc) ? message.cc.join(", ") : message.cc,
          bcc: Array.isArray(message.bcc) ? message.bcc.join(", ") : message.bcc,
          accepted: result.accepted.join(", "),
          rejected: result.rejected.join(", "),
        },
      );
    },
    recordReceived: (email: ReceivedEmail, context: EmailRecordContext = {}) => {
      if (!context.externalKey && !email.messageId) {
        throw new Error("Incoming email without Message-ID requires context.externalKey");
      }
      return record(
        context.externalKey ??
          stableKey("received", `${options.accountKey ?? ""}:${email.messageId ?? ""}`),
        {
          ...relations(context),
          title: email.subject,
          type: options.values?.[email.kind] ?? email.kind,
          date: context.date ?? email.date ?? new Date().toISOString(),
          messageId: email.messageId,
          summary: email.text || email.html || "",
          contact: email.from.join(", "),
          from: email.from.join(", "),
          to: email.to.join(", "),
        },
      );
    },
  };
};
