import type { Buffer } from "node:buffer";

/** Node.js email primitives shared by transports, inbox readers, and record adapters. */
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  cid?: string;
}

export interface EmailMessage {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  markdown?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface RenderedEmail extends Omit<EmailMessage, "markdown"> {
  text: string;
  html?: string;
}

export interface SentEmail {
  provider: "smtp" | "ses";
  /** The identifier returned by the transport; SES identifiers are not RFC Message-IDs. */
  providerMessageId: string;
  /** RFC Message-ID, when the transport can determine it without guessing. */
  messageId: string | null;
  accepted: string[];
  rejected: string[];
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<SentEmail>;
  close?(): void | Promise<void>;
}

export type ReceivedEmailKind = "reply" | "auto-reply" | "bounce";

export interface ReceivedAttachment {
  filename: string | null;
  contentType: string;
  content: Buffer;
  size: number;
}

export interface ReceivedEmail {
  messageId: string | null;
  from: string[];
  to: string[];
  subject: string;
  date: string | null;
  inReplyTo: string[];
  references: string[];
  /** Complete decoded plain-text body, including quoted history and inline answers. */
  text: string;
  /** Heuristic preview only; may omit inline answers. Never use instead of the complete body. */
  replyText?: string;
  html: string | null;
  kind: ReceivedEmailKind;
  attachments: ReceivedAttachment[];
}

export interface ReplyWatch {
  messageIds?: string[];
  senders?: string[];
  /** Raw SES response identifiers, matched only against SES-generated reference domains. */
  sesMessageIds?: string[];
}

export interface ReplyMatch {
  matchedBy: "thread" | "sender" | "sender+thread";
  repliesToMessageId: string | null;
}
