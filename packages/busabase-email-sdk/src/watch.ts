import type { ReplyWatch } from "./types.js";

export interface ReplyWatchRecordsClient {
  records: {
    list(input: { baseId: string; status: "active"; limit: number; cursor?: string }): Promise<{
      records: Array<{
        status?: "active" | "archived";
        headCommit: { payload: Record<string, unknown> };
      }>;
      nextCursor: string | null;
    }>;
  };
}

export interface ReplyWatchFields {
  type?: string;
  messageId?: string;
  providerMessageId?: string;
  provider?: string;
  contact?: string;
  campaign?: string;
  account?: string;
}

export interface LoadReplyWatchOptions {
  client: ReplyWatchRecordsClient;
  baseId: string;
  fields: ReplyWatchFields;
  /** Exact stored value (choice ID for a select), not its display label. */
  sentValue?: string;
  campaignId?: string;
  accountKey?: string;
  /** Fallback for legacy records without a provider field; never inferred from IDs. */
  provider?: "smtp" | "ses";
  pageSize?: number;
  maxPages?: number;
}

const strings = (value: unknown): string[] => {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim())
    : [];
};

/**
 * Builds reply matching inputs from canonical sent records, including every page.
 * Configure type when a Base mixes sent and received events; omitted type means
 * the Base already contains only outbound records. Pending proposals are not canonical.
 */
export const loadReplyWatch = async (options: LoadReplyWatchOptions): Promise<ReplyWatch> => {
  const { fields } = options;
  if (!options.baseId.trim()) throw new Error("Reply watch baseId is required");
  if (options.campaignId !== undefined && !fields.campaign) {
    throw new Error("campaignId requires a campaign field mapping");
  }
  if (options.accountKey !== undefined && !fields.account) {
    throw new Error("accountKey requires an account field mapping");
  }
  if (Object.values(fields).some((slug) => !slug.trim())) {
    throw new Error("Reply watch field mappings must not be empty");
  }
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 1000;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("Reply watch pageSize must be between 1 and 100");
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error("Reply watch maxPages must be a positive integer");
  }
  const messageIds = new Set<string>();
  const senders = new Set<string>();
  const sesMessageIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await options.client.records.list({
      baseId: options.baseId,
      status: "active",
      limit: pageSize,
      ...(cursor ? { cursor } : {}),
    });
    for (const record of result.records) {
      if (record.status === "archived") continue;
      const payload = record.headCommit.payload;
      if (fields.type && !strings(payload[fields.type]).includes(options.sentValue ?? "sent"))
        continue;
      if (
        fields.campaign &&
        options.campaignId !== undefined &&
        !strings(payload[fields.campaign]).includes(options.campaignId)
      )
        continue;
      if (
        fields.account &&
        options.accountKey !== undefined &&
        !strings(payload[fields.account]).includes(options.accountKey)
      )
        continue;
      if (fields.messageId) {
        for (const id of strings(payload[fields.messageId])) messageIds.add(id);
      }
      const provider =
        fields.provider && payload[fields.provider] !== undefined
          ? payload[fields.provider]
          : options.provider;
      if (provider === "ses" && fields.providerMessageId) {
        for (const id of strings(payload[fields.providerMessageId])) sesMessageIds.add(id);
      }
      if (fields.contact) {
        for (const contact of strings(payload[fields.contact])) {
          // Recipient cells may contain comma-separated addresses or display names.
          for (const match of contact.matchAll(/[^<>\s,;]+@[^<>\s,;]+/g)) {
            senders.add(match[0].toLowerCase());
          }
        }
      }
    }
    if (result.nextCursor === null) {
      return {
        messageIds: [...messageIds],
        senders: [...senders],
        sesMessageIds: [...sesMessageIds],
      };
    }
    if (!result.nextCursor || seenCursors.has(result.nextCursor)) {
      throw new Error("Reply watch pagination returned an invalid or repeated cursor");
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error(`Reply watch exceeded maxPages (${maxPages}); no partial watch was returned`);
};
