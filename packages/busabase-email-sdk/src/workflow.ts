import type { EmailRecordContext, EmailRecordResult } from "./busabase.js";
import { type ImapConfig, type ImapCursor, readImapReplies } from "./inbound/imap.js";
import { type InboxSyncCheckpoint, syncReceivedEmails } from "./sync.js";
import type {
  EmailMessage,
  EmailTransport,
  ReceivedEmail,
  ReplyMatch,
  ReplyWatch,
  SentEmail,
} from "./types.js";

export interface EmailRecordStore {
  recordSent(
    message: EmailMessage,
    result: SentEmail,
    context?: EmailRecordContext,
  ): Promise<EmailRecordResult>;
  recordReceived(email: ReceivedEmail, context?: EmailRecordContext): Promise<EmailRecordResult>;
}

/** Sending succeeded: retry recordSent with receipt, never send the same email again. */
export class SentEmailNotRecordedError extends Error {
  constructor(
    public readonly receipt: SentEmail,
    public readonly originalMessage: EmailMessage,
    public readonly context: EmailRecordContext | undefined,
    cause: unknown,
  ) {
    super(
      "Email was sent, but its record could not be saved. Retry recording this receipt; do not resend.",
      { cause },
    );
    this.name = "SentEmailNotRecordedError";
  }
}

/** Explicit send with no automatic retry; retain the receipt even if recording fails. */
export const sendAndRecord = async (options: {
  transport: EmailTransport;
  store: EmailRecordStore;
  message: EmailMessage;
  context?: EmailRecordContext;
}): Promise<{ receipt: SentEmail; record: EmailRecordResult }> => {
  const receipt = await options.transport.send(options.message);
  try {
    return {
      receipt,
      record: await options.store.recordSent(options.message, receipt, options.context),
    };
  } catch (cause) {
    throw new SentEmailNotRecordedError(receipt, options.message, options.context, cause);
  }
};

export interface ImapSyncState {
  accountKey: string;
  watchKey: string;
  cursor: ImapCursor;
  checkpoint: InboxSyncCheckpoint;
}

export interface ReplyResolutionEntry {
  email: ReceivedEmail;
  match: ReplyMatch;
  uid: number;
}

/** A sender-only match needs an explicit routing or skip decision before checkpointing. */
export class ReplyNeedsResolutionError extends Error {
  constructor(public readonly entry: ReplyResolutionEntry) {
    super("Reply matched only by sender; resolve its campaign before acknowledging this message.");
    this.name = "ReplyNeedsResolutionError";
  }
}

/** Poll one bounded batch. Persist state atomically; run only one poll per account at a time. */
export const syncImapReplies = async (options: {
  accountKey: string;
  /** Stable identity for this campaign/watch; never reuse its state for another watch. */
  watchKey: string;
  imap: ImapConfig;
  watch: ReplyWatch;
  store: EmailRecordStore;
  state?: ImapSyncState;
  limit?: number;
  since?: Date;
  /** Explicitly route matching mail; null intentionally acknowledges it without recording. */
  resolveContext?: (
    entry: ReplyResolutionEntry,
  ) => EmailRecordContext | null | Promise<EmailRecordContext | null>;
  saveState: (state: ImapSyncState) => Promise<void>;
}): Promise<ImapSyncState> => {
  if (!options.accountKey.trim()) throw new Error("A stable accountKey is required");
  if (!options.watchKey.trim()) throw new Error("A stable watchKey is required");
  if (
    ![
      ...(options.watch.messageIds ?? []),
      ...(options.watch.sesMessageIds ?? []),
      ...(options.watch.senders ?? []),
    ].some((value) => value.trim())
  ) {
    throw new Error("An empty reply watch cannot acknowledge inbox messages");
  }
  const previous = options.state;
  if (
    previous &&
    (previous.accountKey !== options.accountKey ||
      previous.watchKey !== options.watchKey ||
      previous.cursor.uid !== previous.checkpoint.uid)
  ) {
    throw new Error("Inbox state belongs to another account/watch or contains inconsistent UIDs");
  }
  const batch = await readImapReplies(options.imap, {
    watch: options.watch,
    cursor: previous?.cursor,
    limit: options.limit,
    since: options.since,
    // Unmatched mail is only acknowledged, never recorded, so its body is not needed.
    download: "matched",
  });
  const scope = JSON.stringify([
    options.accountKey,
    options.watchKey,
    batch.cursor.mailbox,
    batch.cursor.uidValidity,
  ]);
  const contexts = new Map<number, EmailRecordContext | null>();
  // Resolve attribution before any checkpoint changes. A resolver failure leaves the batch replayable.
  for (const entry of batch.messages) {
    if (!entry.match) continue;
    const candidate: ReplyResolutionEntry = { ...entry, match: entry.match };
    if (options.resolveContext) contexts.set(entry.uid, await options.resolveContext(candidate));
    else if (entry.match.matchedBy === "sender") throw new ReplyNeedsResolutionError(candidate);
    else contexts.set(entry.uid, {});
  }
  const save = async (checkpoint: InboxSyncCheckpoint): Promise<ImapSyncState> => {
    const state = {
      accountKey: options.accountKey,
      watchKey: options.watchKey,
      cursor: { ...batch.cursor, uid: checkpoint.uid },
      checkpoint,
    };
    await options.saveState(state);
    return state;
  };
  const checkpoint = await syncReceivedEmails({
    scope,
    messages: batch.messages,
    checkpoint: previous?.checkpoint,
    shouldRecord: ({ uid }) => contexts.has(uid) && contexts.get(uid) !== null,
    record: ({ email, uid }) =>
      options.store.recordReceived(email, {
        ...contexts.get(uid),
        // Let the store use its normal account-scoped MIME key; only malformed mail needs a fallback.
        ...(!email.messageId && !contexts.get(uid)?.externalKey
          ? {
              externalKey: JSON.stringify([
                options.accountKey,
                batch.cursor.mailbox,
                batch.cursor.uidValidity,
                uid,
              ]),
            }
          : {}),
      }),
    saveCheckpoint: async (value) => {
      await save(value);
    },
  });
  // Concurrent expunges can advance the read cursor beyond the final downloaded message.
  return save({ ...checkpoint, uid: batch.cursor.uid });
};
