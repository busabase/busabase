import { ImapFlow } from "imapflow";
import type { ReceivedEmail, ReplyMatch, ReplyWatch } from "../types.js";
import { matchReply } from "./match.js";
import { parseEmail } from "./parser.js";

export type ImapConfig = ConstructorParameters<typeof ImapFlow>[0] & { mailbox?: string };

/** UIDs per FETCH: one round trip per chunk, while bounding full messages held in memory. */
const FETCH_CHUNK = 25;

export interface ImapCursor {
  mailbox: string;
  /** Decimal UIDVALIDITY is a string to preserve the server's full integer. */
  uidValidity: string;
  uid: number;
}

export interface ReadImapOptions {
  watch: ReplyWatch;
  cursor?: ImapCursor;
  since?: Date;
  /** Maximum messages scanned, including unrelated messages. Default 100; maximum 1000. */
  limit?: number;
  /**
   * `"all"` (default) downloads every message. `"matched"` downloads headers first and the
   * full message only when the headers already match the watch or it looks like a bounce;
   * other messages come back with headers only (empty text, html and attachments). No watched
   * reply or bounce is missed: matching reads only headers, except a bounce's attached
   * original, and every bounce is downloaded in full.
   */
  download?: "all" | "matched";
}

export interface ImapReplyBatch {
  /** Includes unrelated messages: acknowledge the complete batch before persisting its cursor. */
  messages: { email: ReceivedEmail; match: ReplyMatch | null; uid: number }[];
  cursor: ImapCursor;
}

export class MailboxResetError extends Error {
  constructor(
    public readonly previous: ImapCursor,
    public readonly currentUidValidity: string,
  ) {
    super(
      "Mailbox UIDVALIDITY changed; restart explicitly without the old cursor and deduplicate stored messages.",
    );
    this.name = "MailboxResetError";
  }
}

/** Reads with EXAMINE/BODY.PEEK; never marks Seen or saves progress automatically. */
export const readImapReplies = async (
  config: ImapConfig,
  options: ReadImapOptions,
): Promise<ImapReplyBatch> => {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("IMAP limit must be an integer between 1 and 1000.");
  if (options.since && Number.isNaN(options.since.getTime()))
    throw new Error("Invalid IMAP since date.");
  const { mailbox = "INBOX", ...connection } = config;
  if (
    options.cursor &&
    (options.cursor.mailbox !== mailbox ||
      !Number.isSafeInteger(options.cursor.uid) ||
      options.cursor.uid < 0 ||
      !/^\d+$/.test(options.cursor.uidValidity))
  ) {
    throw new Error("Invalid cursor or cursor belongs to another mailbox.");
  }
  const client = new ImapFlow({ logger: false, ...connection });
  let release: (() => void) | undefined;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    release = () => lock.release();
    if (!client.mailbox) throw new Error("IMAP server did not select a mailbox.");
    const uidValidity = String(client.mailbox.uidValidity);
    if (!/^\d+$/.test(uidValidity))
      throw new Error("IMAP server did not supply a valid UIDVALIDITY.");
    if (options.cursor && options.cursor.uidValidity !== uidValidity)
      throw new MailboxResetError(options.cursor, uidValidity);
    const previousUid = options.cursor?.uid ?? 0;
    const found = await client.search(
      { uid: `${previousUid + 1}:*`, ...(options.since ? { since: options.since } : {}) },
      { uid: true },
    );
    // UID n:* may include the final message even when n exceeds the largest UID.
    const uids = (found || [])
      .filter((uid) => uid > previousUid)
      .sort((a, b) => a - b)
      .slice(0, limit);
    // Collect a whole FETCH before parsing; IMAP cannot interleave another command.
    const download = async (wanted: number[], part: "source" | "headers") => {
      const found = new Map<number, Buffer>();
      if (wanted.length === 0) return found;
      for await (const result of client.fetch(wanted, { [part]: true, uid: true }, { uid: true })) {
        const data = result[part];
        if (!data) {
          throw new Error(
            `IMAP message UID ${result.uid} has no ${part}; cursor was not advanced.`,
          );
        }
        found.set(result.uid, data);
      }
      return found;
    };
    const messages: ImapReplyBatch["messages"] = [];
    for (let start = 0; start < uids.length; start += FETCH_CHUNK) {
      const chunk = uids.slice(start, start + FETCH_CHUNK);
      const headerOnly = new Map<number, ReceivedEmail>();
      let full = chunk;
      if (options.download === "matched") {
        const headers = await download(chunk, "headers");
        full = [];
        for (const uid of chunk) {
          const raw = headers.get(uid);
          if (!raw) continue;
          const email = await parseEmail(raw);
          if (email.kind === "bounce" || matchReply(email, options.watch)) full.push(uid);
          else headerOnly.set(uid, email);
        }
      }
      const sources = await download(full, "source");
      for (const uid of chunk) {
        const source = sources.get(uid);
        if (source) {
          const email = await parseEmail(source);
          messages.push({ email, match: matchReply(email, options.watch), uid });
          continue;
        }
        const email = headerOnly.get(uid);
        if (email) messages.push({ email, match: null, uid });
        // Otherwise it was expunged after SEARCH: safe to acknowledge, nothing left to process.
      }
    }
    return { messages, cursor: { mailbox, uidValidity, uid: uids.at(-1) ?? previousUid } };
  } finally {
    try {
      release?.();
    } finally {
      try {
        await client.logout();
      } finally {
        client.close();
      }
    }
  }
};
