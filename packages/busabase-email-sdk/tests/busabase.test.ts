import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createBusabaseClient } from "busabase-sdk";
import { describe, expect, it } from "vitest";
import { createBusabaseEmailStore } from "../src/busabase.js";
import type { ReceivedEmail } from "../src/types.js";

const email: ReceivedEmail = {
  messageId: "<reply@example.com>",
  from: ["buyer@example.com"],
  to: ["sales@example.com"],
  subject: "Re: Your project",
  date: "2026-10-22T12:00:00.000Z",
  inReplyTo: ["<sent@example.com>"],
  references: [],
  text: "Please tell me more",
  html: null,
  kind: "reply",
  attachments: [],
};

describe("Busabase email record HTTP integration", () => {
  it("records partial submission accurately and retains intended recipients separately", async () => {
    const writes: Record<string, unknown>[] = [];
    const store = createBusabaseEmailStore({
      client: {
        records: { search: async () => [] },
        bases: {
          createChangeRequest: async (input) => {
            writes.push(input.fields);
            return { id: "partial-record", materialized: true };
          },
        },
      },
      baseId: "records",
      fields: {
        externalKey: "key",
        contact: "peer",
        to: "intended",
        accepted: "accepted",
        rejected: "rejected",
        summary: "body",
      },
    });
    const message = {
      from: "sales@example.com",
      to: ["buyer@example.net", "missing@example.net"],
      subject: "Hello",
      text: "Hello",
    };
    const receipt = {
      provider: "smtp" as const,
      providerMessageId: "<partial@example.com>",
      messageId: "<partial@example.com>",
      accepted: ["buyer@example.net"],
      rejected: ["missing@example.net"],
    };
    await store.recordSent(message, receipt);
    expect(writes[0]).toMatchObject({
      peer: "buyer@example.net",
      intended: "buyer@example.net, missing@example.net",
      accepted: "buyer@example.net",
      rejected: "missing@example.net",
    });
    expect(writes[0]?.body).toContain("Submission rejected: missing@example.net");
    expect(() => store.recordSent(message, { ...receipt, accepted: [] })).toThrow(
      "accepted recipients",
    );
    expect(writes).toHaveLength(1);
  });
  it("uses real SDK routes, maps relations, dedupes records and preserves permission-aware pending requests", async () => {
    const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
    const proposals = new Map<string, string>();
    let materialized = false;
    let canonical = false;
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      requests.push({ method: request.method ?? "", url: request.url ?? "", body: parsed });
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET") {
        response.end(JSON.stringify(canonical ? [{ id: "rec-existing" }] : []));
      } else {
        const key = String(parsed.idempotencyKey);
        const id = proposals.get(key) ?? `cr-${proposals.size + 1}`;
        proposals.set(key, id);
        response.end(
          JSON.stringify(
            materialized
              ? { id: "rec-applied", materialized: true }
              : { id, status: "in_review", materialized: false },
          ),
        );
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const client = createBusabaseClient({
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: "test-only",
        spaceId: "test-space",
      });
      const config = {
        client,
        baseId: "outreach-records",
        campaignId: "campaign-test",
        fields: {
          externalKey: "external-key",
          title: "title",
          contact: "contact",
          contactRelation: "lead",
          campaign: "campaign",
          type: "event",
          summary: "notes",
        },
        values: { reply: "Received reply" },
      };
      const store = createBusabaseEmailStore(config);
      const first = await store.recordReceived(email, { contactId: "lead-test" });
      expect(first.status).toBe("pending");
      expect(first.changeRequestId).toBe("cr-1");
      const replay = await createBusabaseEmailStore(config).recordReceived(email);
      expect(replay.changeRequestId).toBe(first.changeRequestId);
      // Separate SDK/store instances simulate independent retrying workers.
      const concurrent = await Promise.all([
        createBusabaseEmailStore(config).recordReceived(email),
        createBusabaseEmailStore(config).recordReceived(email),
      ]);
      expect(concurrent.every((result) => result.changeRequestId === "cr-1")).toBe(true);
      expect(proposals.size).toBe(1);
      const write = requests.find((request) => request.method === "POST");
      expect(write?.url).toBe("/api/v1/bases/outreach-records/change-requests");
      expect(write?.body).not.toHaveProperty("autoMerge");
      expect(write?.body.fields).toMatchObject({
        title: email.subject,
        contact: "buyer@example.com",
        lead: ["lead-test"],
        campaign: ["campaign-test"],
        event: "Received reply",
        notes: email.text,
      });
      expect(write?.body.idempotencyKey).toBe(first.externalKey);
      const search = new URL(requests[0]?.url ?? "", "http://localhost");
      expect(search.pathname).toBe("/api/v1/records/search");
      expect(search.searchParams.get("baseId")).toBe("outreach-records");
      expect(search.searchParams.get("fieldSlug")).toBe("external-key");
      expect(search.searchParams.get("valueText")).toBe(first.externalKey);
      canonical = true;
      const writesBeforeDuplicate = requests.filter((request) => request.method === "POST").length;
      expect(await store.recordReceived(email)).toMatchObject({
        status: "duplicate",
        recordId: "rec-existing",
      });
      expect(requests.filter((request) => request.method === "POST")).toHaveLength(
        writesBeforeDuplicate,
      );
      canonical = false;
      materialized = true;
      expect(
        await store.recordReceived({ ...email, messageId: "<next@example.com>" }),
      ).toMatchObject({ status: "applied", recordId: "rec-applied" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("namespaces accounts and records SES identifiers separately from RFC Message-IDs", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const client = {
      records: { search: async () => [] },
      bases: {
        createChangeRequest: async (input: { fields: Record<string, unknown> }) => {
          writes.push(input.fields);
          return { id: "rec-sent", materialized: true };
        },
      },
    };
    const config = {
      client,
      baseId: "records",
      fields: {
        externalKey: "key",
        contact: "email",
        date: "date",
        messageId: "message",
        providerMessageId: "provider",
        provider: "transport",
        account: "account",
      },
    };
    const sales = createBusabaseEmailStore({ ...config, accountKey: "sales/INBOX" });
    const support = createBusabaseEmailStore({ ...config, accountKey: "support/INBOX" });
    const a = await sales.recordReceived(email);
    const b = await support.recordReceived(email);
    expect(a.externalKey).not.toBe(b.externalKey);
    await sales.recordSent(
      { from: "sales@example.com", to: "buyer@example.com", subject: "hello", text: "Hello" },
      {
        provider: "ses",
        providerMessageId: "ses-id-1",
        messageId: null,
        accepted: ["buyer@example.com"],
        rejected: [],
      },
      { date: "2026-10-22T12:00:00.000Z" },
    );
    expect(writes[2]).toMatchObject({
      email: "buyer@example.com",
      date: "2026-10-22T12:00:00.000Z",
      provider: "ses-id-1",
      transport: "ses",
      account: "sales/INBOX",
    });
    expect(writes[2]).not.toHaveProperty("message");
  });

  it("requires explicit identity for malformed mail and rejects unsuccessful replayed proposals", async () => {
    const client = {
      records: { search: async () => [] },
      bases: {
        createChangeRequest: async () => ({
          id: "cr-rejected",
          materialized: false,
          status: "rejected",
        }),
      },
    };
    const store = createBusabaseEmailStore({
      client,
      baseId: "records",
      fields: { externalKey: "external-key" },
    });
    expect(() => store.recordReceived({ ...email, messageId: null })).toThrow(
      "requires context.externalKey",
    );
    await expect(store.recordReceived(email)).rejects.toThrow("not pending: rejected");
  });

  it("recognizes a merged idempotency replay as applied and coalesces local concurrent writes", async () => {
    let writes = 0;
    const client = {
      records: { search: async () => [] },
      bases: {
        createChangeRequest: async () => {
          writes += 1;
          return { id: "cr-merged", materialized: false, status: "merged" };
        },
      },
    };
    const store = createBusabaseEmailStore({
      client,
      baseId: "records",
      fields: { externalKey: "external-key" },
    });
    const results = await Promise.all([store.recordReceived(email), store.recordReceived(email)]);
    expect(writes).toBe(1);
    expect(results).toEqual(
      Array(2).fill({
        status: "applied",
        externalKey: results[0]?.externalKey,
        changeRequestId: "cr-merged",
      }),
    );
  });
});
