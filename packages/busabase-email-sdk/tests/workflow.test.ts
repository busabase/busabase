import { describe, expect, it, vi } from "vitest";
import { createBusabaseEmailStore, type EmailRecordResult } from "../src/busabase.js";
import type { ReceivedEmail, SentEmail } from "../src/types.js";
import {
  type EmailRecordStore,
  type ImapSyncState,
  SentEmailNotRecordedError,
  sendAndRecord,
  syncImapReplies,
} from "../src/workflow.js";
import { mailboxFixture } from "./fixtures/imap.js";

const applied: EmailRecordResult = { status: "applied", externalKey: "event", recordId: "record" };
const receipt: SentEmail = {
  provider: "smtp",
  messageId: "<sent@example.com>",
  providerMessageId: "<sent@example.com>",
  accepted: ["buyer@example.net"],
  rejected: [],
};
const store = (): EmailRecordStore => ({
  recordSent: async () => applied,
  recordReceived: async () => applied,
});

describe("send and inbox workflows", () => {
  it("retains a successful delivery receipt when recording fails, without retrying the send", async () => {
    const send = vi.fn(async () => receipt);
    const records = store();
    records.recordSent = async () => {
      throw new Error("database unavailable");
    };
    const message = {
      from: "sales@example.com",
      to: "buyer@example.net",
      subject: "Hello",
      text: "Hello",
    };
    try {
      await sendAndRecord({
        transport: { send },
        store: records,
        message,
        context: { externalKey: "approved-send", campaignId: "campaign-a" },
      });
      expect.fail("Expected recording failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SentEmailNotRecordedError);
      expect((error as SentEmailNotRecordedError).receipt).toEqual(receipt);
      expect((error as SentEmailNotRecordedError).originalMessage).toEqual(message);
      expect((error as SentEmailNotRecordedError).context).toEqual({
        externalKey: "approved-send",
        campaignId: "campaign-a",
      });
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reads actual IMAP mail, skips unrelated messages, and resumes after a record failure", async () => {
    const fixture = await mailboxFixture();
    let persisted: ImapSyncState | undefined;
    const observed: string[] = [];
    let fail = true;
    const records = store();
    records.recordReceived = async (email) => {
      if (!email.messageId) throw new Error("Expected fixture Message-ID");
      observed.push(email.messageId);
      if (fail) throw new Error("write failed");
      return {
        status: "pending",
        externalKey: email.messageId,
        changeRequestId: `cr-${email.messageId}`,
      };
    };
    const options = {
      accountKey: "sales",
      watchKey: "campaign-a",
      imap: fixture.config,
      watch: { messageIds: ["<sent@example.com>"], senders: ["buyer@example.net"] },
      store: records,
      resolveContext: async () => ({}),
      saveState: async (state: ImapSyncState) => {
        persisted = state;
      },
    };
    try {
      await expect(syncImapReplies(options)).rejects.toThrow("write failed");
      expect(persisted?.cursor.uid).toBe(2);
      fail = false;
      const state = await syncImapReplies({ ...options, state: persisted });
      expect(state.cursor.uid).toBe(9);
      expect(state.checkpoint.pendingChangeRequests).toHaveLength(2);
      expect(observed).toEqual(["<five@example.net>", "<five@example.net>", "<nine@example.net>"]);
      const empty = await syncImapReplies({ ...options, state });
      expect(empty).toEqual(state);
    } finally {
      await fixture.close();
    }
  });
  it("stops on a same-buyer sender-only candidate without writing or advancing state", async () => {
    const fixture = await mailboxFixture();
    const records = store();
    records.recordReceived = vi.fn(async () => applied);
    const saveState = vi.fn(async () => {});
    try {
      await expect(
        syncImapReplies({
          accountKey: "sales",
          watchKey: "campaign-a",
          imap: fixture.config,
          watch: { messageIds: ["<campaign-a@example.com>"], senders: ["buyer@example.net"] },
          store: records,
          saveState,
        }),
      ).rejects.toMatchObject({
        name: "ReplyNeedsResolutionError",
        entry: { uid: 5, match: { matchedBy: "sender" } },
      });
      expect(records.recordReceived).not.toHaveBeenCalled();
      expect(saveState).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it("allows explicit campaign routing or skip, keeps normal store identity, and rejects another watch's state", async () => {
    const fixture = await mailboxFixture();
    const records = store();
    records.recordReceived = vi.fn(async () => applied);
    try {
      const state = await syncImapReplies({
        accountKey: "sales",
        watchKey: "campaign-a",
        imap: fixture.config,
        watch: { messageIds: ["<sent@example.com>"], senders: ["buyer@example.net"] },
        store: records,
        resolveContext: ({ uid }) => (uid === 5 ? { campaignId: "campaign-b" } : null),
        saveState: async () => {},
      });
      expect(records.recordReceived).toHaveBeenCalledTimes(1);
      expect(records.recordReceived).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: "<five@example.net>" }),
        { campaignId: "campaign-b" },
      );
      expect(state.watchKey).toBe("campaign-a");
      expect(state.cursor.uid).toBe(9);
      await expect(
        syncImapReplies({
          accountKey: "sales",
          watchKey: "campaign-b",
          imap: fixture.config,
          watch: { messageIds: ["<sent@example.com>"] },
          store: records,
          state,
          saveState: async () => {},
        }),
      ).rejects.toThrow("another account/watch");
    } finally {
      await fixture.close();
    }
  });

  it("rejects an empty watch before connecting to or acknowledging the inbox", async () => {
    await expect(
      syncImapReplies({
        accountKey: "sales",
        watchKey: "campaign-a",
        imap: { host: "unreachable.invalid", port: 993, secure: true },
        watch: {},
        store: store(),
        saveState: async () => {},
      }),
    ).rejects.toThrow("empty reply watch");
  });
  it("deduplicates low-level and high-level processing using the same account-scoped identity", async () => {
    const fixture = await mailboxFixture();
    const written = new Set<string>();
    const searches: string[] = [];
    const client = {
      records: {
        search: async ({ valueText }: { valueText: string }) => {
          searches.push(valueText);
          return written.has(valueText) ? [{ id: "existing" }] : [];
        },
      },
      bases: {
        createChangeRequest: async ({ fields }: { fields: Record<string, unknown> }) => {
          written.add(String(fields.key));
          return { id: "created", materialized: true };
        },
      },
    };
    const records = createBusabaseEmailStore({
      client,
      baseId: "logs",
      accountKey: "sales",
      fields: { externalKey: "key" },
    });
    const email: ReceivedEmail = {
      messageId: "<five@example.net>",
      from: ["buyer@example.net"],
      to: ["sales@example.com"],
      subject: "Re: Hello",
      date: null,
      inReplyTo: ["<sent@example.com>"],
      references: [],
      text: "Yes please.",
      html: null,
      kind: "reply",
      attachments: [],
    };
    try {
      const first = await records.recordReceived(email);
      await syncImapReplies({
        accountKey: "sales",
        watchKey: "campaign-a",
        imap: fixture.config,
        watch: { messageIds: ["<sent@example.com>"] },
        store: records,
        saveState: async () => {},
      });
      expect(written.size).toBe(1);
      expect(searches).toEqual([first.externalKey, first.externalKey]);
    } finally {
      await fixture.close();
    }
  });
});
