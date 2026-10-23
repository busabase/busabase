import type { ReceivedEmail } from "../types.js";
import { parseEmail } from "./parser.js";

export interface SesNotification {
  type: "delivery" | "bounce" | "complaint" | "open" | "click";
  providerMessageId: string;
  timestamp: string | null;
  recipients: string[];
  bounceType?: string;
  bounceSubType?: string;
  complaintFeedbackType?: string;
  url?: string;
  ipAddress?: string;
  userAgent?: string;
}

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as ObjectValue) : {};
const string = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const unwrap = (payload: unknown): ObjectValue => {
  let value = payload;
  if (typeof value === "string") value = JSON.parse(value);
  let result = object(value);
  if (typeof result.Message === "string") result = object(JSON.parse(result.Message));
  return result;
};

/** Parser only. The receiving server MUST verify SNS/webhook authenticity before calling this. */
export const parseSesNotification = (payload: unknown): SesNotification => {
  const data = unwrap(payload);
  const type = String(data.eventType ?? data.notificationType ?? "").toLowerCase();
  if (
    type !== "delivery" &&
    type !== "bounce" &&
    type !== "complaint" &&
    type !== "open" &&
    type !== "click"
  )
    throw new Error("Unsupported SES notification type.");
  const mail = object(data.mail);
  const providerMessageId = string(mail.messageId);
  if (!providerMessageId) throw new Error("SES notification has no mail.messageId.");
  const detail = object(data[type]);
  const affected =
    type === "bounce"
      ? detail.bouncedRecipients
      : type === "complaint"
        ? detail.complainedRecipients
        : undefined;
  const recipients = Array.isArray(affected)
    ? affected.flatMap((entry) => {
        const address = string(object(entry).emailAddress);
        return address ? [address] : [];
      })
    : strings(type === "delivery" ? (detail.recipients ?? mail.destination) : mail.destination);
  return {
    type,
    providerMessageId,
    recipients,
    timestamp: string(detail.timestamp) ?? string(mail.timestamp) ?? null,
    ...(string(detail.bounceType) ? { bounceType: string(detail.bounceType) } : {}),
    ...(string(detail.bounceSubType) ? { bounceSubType: string(detail.bounceSubType) } : {}),
    ...(string(detail.complaintFeedbackType)
      ? { complaintFeedbackType: string(detail.complaintFeedbackType) }
      : {}),
    ...(string(detail.link) ? { url: string(detail.link) } : {}),
    ...(string(detail.ipAddress) ? { ipAddress: string(detail.ipAddress) } : {}),
    ...(string(detail.userAgent) ? { userAgent: string(detail.userAgent) } : {}),
  };
};

export type SesInboundResult =
  | { kind: "email"; email: ReceivedEmail }
  | { kind: "s3"; bucket: string; key: string; providerMessageId: string | null };

const parseRawMime = async (raw: string | Buffer): Promise<SesInboundResult> => {
  if (!/^[\w-]+:[^\r\n]*(?:\r?\n)/.test(raw.toString()))
    throw new Error("SES inbound input is not a MIME message or notification.");
  return { kind: "email", email: await parseEmail(raw) };
};

/** Does not fetch S3 or verify webhook signatures. Feed fetched MIME back into this helper. */
export const parseSesInbound = async (payloadOrRaw: unknown): Promise<SesInboundResult> => {
  if (Buffer.isBuffer(payloadOrRaw)) return parseRawMime(payloadOrRaw);
  if (typeof payloadOrRaw === "string" && !payloadOrRaw.trimStart().startsWith("{")) {
    return parseRawMime(payloadOrRaw);
  }
  const data = unwrap(payloadOrRaw);
  if (typeof data.content === "string") return parseRawMime(data.content);
  const records = Array.isArray(data.Records) ? data.Records : [];
  if (records.length > 1)
    throw new Error("Parse SES inbound Records individually to avoid dropping messages.");
  const record = object(records[0]);
  const ses = object(record.ses);
  const receipt = object(ses.receipt ?? data.receipt);
  const action = object(receipt.action);
  const bucket = string(action.bucketName);
  const key = string(action.objectKey);
  if (bucket && key)
    return {
      kind: "s3",
      bucket,
      key,
      providerMessageId: string(object(ses.mail ?? data.mail).messageId) ?? null,
    };
  // SES's default Lambda event supplies headers and receipt metadata, not the MIME body.
  throw new Error(
    "SES inbound notification has no MIME content. Fetch the raw message from S3 using your receipt-rule bucket/key, then parse it.",
  );
};
