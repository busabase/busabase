import type { EmailRecordResult } from "./busabase.js";
import type { ReceivedEmail } from "./types.js";

export interface InboxSyncMessage {
  email: ReceivedEmail;
  uid: number;
}

export interface InboxSyncCheckpoint {
  /** Account + mailbox + UIDVALIDITY. A changed IMAP UIDVALIDITY needs a fresh scope. */
  scope: string;
  uid: number;
  pendingChangeRequests: Array<{ externalKey: string; changeRequestId: string }>;
}

export interface SyncReceivedEmailsOptions {
  scope: string;
  /** Must be in increasing UID order and include every message to be recorded. */
  messages: Iterable<InboxSyncMessage> | AsyncIterable<InboxSyncMessage>;
  checkpoint?: InboxSyncCheckpoint | null;
  /** Unmatched mail can be acknowledged without creating an outreach record. */
  shouldRecord?: (message: InboxSyncMessage) => boolean;
  record: (message: InboxSyncMessage) => Promise<EmailRecordResult>;
  /** Must durably save the complete checkpoint, including pending proposal IDs. */
  saveCheckpoint: (checkpoint: InboxSyncCheckpoint) => Promise<void>;
}

/**
 * Explicit one-shot inbox persistence, with no sending, polling timer or auto-replies.
 * Replays after save failures are expected; record must be idempotent. Pending proposal
 * IDs remain in the checkpoint until the caller reconciles their review outcomes.
 */
export const syncReceivedEmails = async (
  options: SyncReceivedEmailsOptions,
): Promise<InboxSyncCheckpoint> => {
  if (!options.scope.trim()) throw new Error("Inbox checkpoint scope is required");
  if (options.checkpoint && options.checkpoint.scope !== options.scope) {
    throw new Error("Inbox checkpoint belongs to a different mailbox or UIDVALIDITY");
  }
  let checkpoint: InboxSyncCheckpoint = options.checkpoint
    ? {
        ...options.checkpoint,
        pendingChangeRequests: [...options.checkpoint.pendingChangeRequests],
      }
    : { scope: options.scope, uid: 0, pendingChangeRequests: [] };
  if (!Number.isSafeInteger(checkpoint.uid) || checkpoint.uid < 0) {
    throw new Error("Invalid inbox checkpoint UID");
  }
  let previousUid = 0;
  for await (const message of options.messages) {
    if (!Number.isSafeInteger(message.uid) || message.uid <= previousUid) {
      throw new Error("Inbox messages require strictly increasing positive UIDs");
    }
    previousUid = message.uid;
    if (message.uid <= checkpoint.uid) continue;
    const result =
      options.shouldRecord?.(message) === false ? undefined : await options.record(message);
    if (result?.status === "pending" && !result.changeRequestId) {
      throw new Error("Pending email event must retain its Change Request ID");
    }
    const pending = [...checkpoint.pendingChangeRequests];
    if (
      result?.status === "pending" &&
      result.changeRequestId &&
      !pending.some((item) => item.changeRequestId === result.changeRequestId)
    ) {
      pending.push({ externalKey: result.externalKey, changeRequestId: result.changeRequestId });
    }
    const next = { scope: options.scope, uid: message.uid, pendingChangeRequests: pending };
    await options.saveCheckpoint(next);
    checkpoint = next;
  }
  return checkpoint;
};
