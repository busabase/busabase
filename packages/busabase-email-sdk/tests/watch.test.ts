import type { BusabaseClient } from "busabase-sdk";
import { describe, expect, it, vi } from "vitest";
import { loadReplyWatch, type ReplyWatchRecordsClient } from "../src/watch.js";

// Public SDK compatibility is checked at compile time without instantiating a network client.
const acceptsPublicClient = (client: BusabaseClient): ReplyWatchRecordsClient => client;
void acceptsPublicClient;
const row = (payload: Record<string, unknown>, status: "active" | "archived" = "active") => ({
  status,
  headCommit: { payload },
});
const fields = {
  type: "kind",
  campaign: "campaign",
  account: "account",
  contact: "email",
  messageId: "message",
  providerMessageId: "provider-id",
  provider: "provider",
};

describe("loading reply watch from persisted campaign records", () => {
  it("loads every page, applies exact campaign/account/type filters, and deduplicates IDs and recipients", async () => {
    const payload = {
      kind: "sent-choice",
      campaign: ["campaign-1"],
      account: "sales",
      email: "Buyer <Buyer@example.com>, second@example.com",
      message: "<sent@example.com>",
      "provider-id": "ses-1",
      provider: "ses",
    };
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        records: [
          row(payload),
          row({ ...payload, kind: "reply" }),
          row({ ...payload, campaign: ["campaign-10"] }),
          row({ ...payload, account: "other" }),
          row({ ...payload, message: "<archived@test>" }, "archived"),
        ],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        records: [
          row(payload),
          row({
            ...payload,
            message: "<smtp@example.com>",
            provider: "smtp",
            "provider-id": "smtp-id",
          }),
        ],
        nextCursor: null,
      });
    const watch = await loadReplyWatch({
      client: { records: { list } },
      baseId: "logs",
      fields,
      sentValue: "sent-choice",
      campaignId: "campaign-1",
      accountKey: "sales",
      pageSize: 25,
    });
    expect(watch).toEqual({
      messageIds: ["<sent@example.com>", "<smtp@example.com>"],
      senders: ["buyer@example.com", "second@example.com"],
      sesMessageIds: ["ses-1"],
    });
    expect(list.mock.calls.map(([input]) => input)).toEqual([
      { baseId: "logs", status: "active", limit: 25 },
      { baseId: "logs", status: "active", limit: 25, cursor: "page-2" },
    ]);
  });

  it("uses explicit SES fallback for legacy provider IDs and does not guess providers", async () => {
    const list = async () => ({
      records: [row({ "provider-id": "legacy-ses" })],
      nextCursor: null,
    });
    const options = {
      client: { records: { list } },
      baseId: "logs",
      fields: { providerMessageId: "provider-id" },
    };
    expect((await loadReplyWatch(options)).sesMessageIds).toEqual([]);
    expect((await loadReplyWatch({ ...options, provider: "ses" })).sesMessageIds).toEqual([
      "legacy-ses",
    ]);
  });

  it("errors instead of returning a truncated watch or looping cursors", async () => {
    const list = vi.fn(async () => ({ records: [], nextCursor: "again" }));
    const options = { client: { records: { list } }, baseId: "logs", fields: {} };
    await expect(loadReplyWatch({ ...options, maxPages: 1 })).rejects.toThrow("no partial watch");
    await expect(loadReplyWatch(options)).rejects.toThrow("repeated cursor");
  });

  it("rejects unscoped filters and invalid pagination before reading records", async () => {
    const list = vi.fn(async () => ({ records: [], nextCursor: null }));
    const options = { client: { records: { list } }, baseId: "logs", fields: {} };
    await expect(loadReplyWatch({ ...options, campaignId: "c" })).rejects.toThrow("campaign field");
    await expect(loadReplyWatch({ ...options, accountKey: "sales" })).rejects.toThrow(
      "account field",
    );
    await expect(loadReplyWatch({ ...options, pageSize: 101 })).rejects.toThrow("pageSize");
    expect(list).not.toHaveBeenCalled();
  });
});
