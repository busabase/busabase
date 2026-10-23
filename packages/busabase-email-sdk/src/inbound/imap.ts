import { ImapFlow } from "imapflow";
import type { ReceivedEmail, ReplyMatch, ReplyWatch } from "../types.js";
import { matchReply } from "./match.js";
import { parseEmail } from "./parser.js";

export type ImapConfig = ConstructorParameters<typeof ImapFlow>[0] & { mailbox?: string };

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
    const messages: ImapReplyBatch["messages"] = [];
    let uid = previousUid;
    for (const candidate of uids) {
      const result = await client.fetchOne(candidate, { source: true, uid: true }, { uid: true });
      // A concurrent expunge is safe to acknowledge; it has no remaining body to process.
      if (result && "source" in result && result.source) {
        const email = await parseEmail(result.source);
        messages.push({ email, match: matchReply(email, options.watch), uid: candidate });
      } else if (result) {
        throw new Error(`IMAP message UID ${candidate} has no source; cursor was not advanced.`);
      }
      uid = candidate;
    }
    return { messages, cursor: { mailbox, uidValidity, uid } };
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
