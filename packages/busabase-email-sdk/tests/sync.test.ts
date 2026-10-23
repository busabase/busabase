import { describe, expect, it, vi } from "vitest";
import type { EmailRecordResult } from "../src/busabase.js";
import { type InboxSyncCheckpoint, syncReceivedEmails } from "../src/sync.js";
import type { ReceivedEmail } from "../src/types.js";

const email: ReceivedEmail = {
  messageId: "<reply@test>",
  from: [],
  to: [],
  subject: "reply",
  date: null,
  inReplyTo: [],
  references: [],
  text: "hello",
  html: null,
  kind: "reply",
  attachments: [],
};
const scope = "account/INBOX/uidvalidity-42";
const applied: EmailRecordResult = { status: "applied", externalKey: "event-1", recordId: "rec-1" };

describe("reply sync checkpoints", () => {
  it("durably retains pending IDs, skips old UIDs, and advances only after persistence", async () => {
    const order: string[] = [];
    const saved: InboxSyncCheckpoint[] = [];
    const checkpoint = await syncReceivedEmails({
      scope,
      checkpoint: { scope, uid: 1, pendingChangeRequests: [] },
      messages: [1, 2, 3].map((uid) => ({ email, uid })),
      record: async ({ uid }) => {
        order.push(`record:${uid}`);
        return uid === 2
          ? { status: "pending", externalKey: "event-2", changeRequestId: "cr-2" }
          : applied;
      },
      saveCheckpoint: async (value) => {
        order.push(`save:${value.uid}`);
        saved.push(value);
      },
    });
    expect(order).toEqual(["record:2", "save:2", "record:3", "save:3"]);
    expect(checkpoint).toEqual({
      scope,
      uid: 3,
      pendingChangeRequests: [{ externalKey: "event-2", changeRequestId: "cr-2" }],
    });
    expect(saved[0]?.uid).toBe(2);
  });

  it("preserves the last saved UID when a write fails", async () => {
    const saved: number[] = [];
    await expect(
      syncReceivedEmails({
        scope,
        messages: [1, 2, 3].map((uid) => ({ email, uid })),
        record: async ({ uid }) => {
          if (uid === 2) throw new Error("HTTP failed");
          return applied;
        },
        saveCheckpoint: async (value) => {
          saved.push(value.uid);
        },
      }),
    ).rejects.toThrow("HTTP failed");
    expect(saved).toEqual([1]);
  });

  it("stops on checkpoint storage failure so the caller can replay idempotently", async () => {
    const record = vi.fn(async () => applied);
    await expect(
      syncReceivedEmails({
        scope,
        messages: [1, 2].map((uid) => ({ email, uid })),
        record,
        saveCheckpoint: async () => {
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("disk full");
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("rejects scope changes and out-of-order messages", async () => {
    const saveCheckpoint = vi.fn(async () => {});
    await expect(
      syncReceivedEmails({
        scope,
        checkpoint: { scope: "other-validity", uid: 3, pendingChangeRequests: [] },
        messages: [],
        record: async () => applied,
        saveCheckpoint,
      }),
    ).rejects.toThrow("UIDVALIDITY");
    expect(saveCheckpoint).not.toHaveBeenCalled();
    await expect(
      syncReceivedEmails({
        scope,
        messages: [2, 1].map((uid) => ({ email, uid })),
        record: async () => applied,
        saveCheckpoint,
      }),
    ).rejects.toThrow("strictly increasing");
    expect(saveCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("does not checkpoint a pending result that lost its proposal ID", async () => {
    const saveCheckpoint = vi.fn(async () => {});
    await expect(
      syncReceivedEmails({
        scope,
        messages: [{ email, uid: 1 }],
        record: async () => ({ status: "pending", externalKey: "event-1" }),
        saveCheckpoint,
      }),
    ).rejects.toThrow("Change Request ID");
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });
});
