import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBusabaseClient } from "../../../apps/busabase-sdk/src/index";
import {
  createBusabaseEmailStore,
  type EmailMessage,
  type InboxSyncCheckpoint,
  loadReplyWatch,
  type ReceivedEmail,
  type SentEmail,
  syncReceivedEmails,
} from "../../busabase-email-sdk/src/index";
import { type BusabaseDatabase, LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb, getPgliteClient } from "../src/db";
import * as schema from "../src/db/schema";
import { encodeBusabaseOpenApiError } from "../src/openapi/error-envelope";
import { busabaseRouter } from "../src/router";

/** Real public SDK -> localhost HTTP -> production OpenAPI/router -> file-backed PostgreSQL engine. */
describe("Email SDK against a durable Busabase backend", () => {
  let originalCwd = "";
  let dataDir = "";
  let storageDir = "";
  let server: Server | undefined;
  let baseUrl = "";
  let logsBaseId = "";
  let campaignId = "";
  let contactId = "";
  let hostDb: BusabaseDatabase | undefined;
  let reopenedClient: PGlite | undefined;
  let originalClosed = false;
  const writes: Array<{ body: Record<string, unknown>; role: string }> = [];
  const raw = createRouterClient(busabaseRouter);
  const fields = {
    title: "subject",
    externalKey: "event-key",
    type: "event-type",
    date: "event-date",
    contact: "peer-email",
    contactRelation: "lead",
    campaign: "campaign",
    account: "mailbox",
    provider: "transport",
    messageId: "rfc-id",
    providerMessageId: "provider-id",
    summary: "body",
  };
  const values = {
    sent: "sent-choice",
    reply: "reply-choice",
    "auto-reply": "automatic-choice",
    bounce: "bounce-choice",
  };
  const client = (role: "writer" | "proposer" = "writer") =>
    createBusabaseClient({ baseUrl, headers: { "x-test-role": role } });
  const store = (role: "writer" | "proposer" = "writer") =>
    createBusabaseEmailStore({
      client: client(role),
      baseId: logsBaseId,
      fields,
      values,
      accountKey: "sales-mailbox",
      campaignId,
    });
  const message = (subject: string): EmailMessage => ({
    from: "sales@example.com",
    to: "buyer@example.net",
    subject,
    markdown: "## Details\n\n[View case](https://example.com/case#section-2)",
  });
  const receipt = (id: string): SentEmail => ({
    provider: "smtp",
    messageId: `<${id}@example.com>`,
    providerMessageId: `<${id}@example.com>`,
    accepted: ["buyer@example.net"],
    rejected: [],
  });
  const reply = (id: string): ReceivedEmail => ({
    messageId: `<${id}@example.net>`,
    from: ["buyer@example.net"],
    to: ["sales@example.com"],
    subject: "Re: Can we discuss this?",
    date: "2026-10-23T01:00:00.000Z",
    inReplyTo: ["<sent-first@example.com>"],
    references: [],
    text: "Yes, please send a proposal.",
    html: null,
    kind: "reply",
    attachments: [],
  });

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-email-sdk-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-email-sdk-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const campaigns = await raw.bases.create({
      slug: "email-sdk-campaigns",
      name: "Email campaigns",
      fields: [{ slug: "name", name: "Name", type: "text" }],
      autoMerge: true,
    });
    const contacts = await raw.bases.create({
      slug: "email-sdk-contacts",
      name: "Email contacts",
      fields: [{ slug: "name", name: "Name", type: "text" }],
      autoMerge: true,
    });
    if (!campaigns.materialized || !contacts.materialized)
      throw new Error("Expected canonical seed Bases");
    const campaign = await raw.bases.createChangeRequest({
      baseId: campaigns.id,
      fields: { name: "Exhibition follow-up" },
    });
    const contact = await raw.bases.createChangeRequest({
      baseId: contacts.id,
      fields: { name: "Example buyer" },
    });
    if (!campaign.materialized || !contact.materialized)
      throw new Error("Expected canonical seed records");
    campaignId = campaign.id;
    contactId = contact.id;
    const logs = await raw.bases.create({
      slug: "email-sdk-logs",
      name: "Email conversation log",
      autoMerge: true,
      fields: [
        ...[
          "subject",
          "event-key",
          "peer-email",
          "mailbox",
          "transport",
          "rfc-id",
          "provider-id",
        ].map((slug) => ({ slug, name: slug, type: "text" })),
        {
          slug: "event-type",
          name: "Event type",
          type: "select",
          options: { choices: Object.values(values).map((value) => ({ id: value, name: value })) },
        },
        { slug: "event-date", name: "Event date", type: "date" },
        { slug: "body", name: "Body", type: "markdown" },
        {
          slug: "lead",
          name: "Lead",
          type: "relation",
          options: { targetBaseId: contacts.id, multiple: true },
        },
        {
          slug: "campaign",
          name: "Campaign",
          type: "relation",
          options: { targetBaseId: campaigns.id, multiple: true },
        },
      ],
    });
    if (!logs.materialized) throw new Error("Expected canonical email log Base");
    logsBaseId = logs.id;
    const handler = new OpenAPIHandler(busabaseRouter, {
      customErrorResponseBodyEncoder: encodeBusabaseOpenApiError,
    });
    server = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        const role = request.headers["x-test-role"] === "proposer" ? "proposer" : "writer";
        if (request.method === "POST")
          writes.push({ role, body: JSON.parse(body.toString()) as Record<string, unknown> });
        const result = await runWithBusabaseContext(
          {
            db: hostDb,
            spaceId: LOCAL_SPACE_ID,
            actorId: "email-sdk-test-actor",
            isSpaceManager: true,
            permissionLevel: "manage",
            credentialPermissionCeiling: role === "proposer" ? "changeRequest" : "write",
          },
          () =>
            handler.handle(
              new Request(`http://localhost${request.url}`, {
                method: request.method,
                headers: { "content-type": "application/json" },
                ...(body.length ? { body } : {}),
              }),
              { context: {} },
            ),
        );
        if (!result.matched || !result.response) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(result.response.status, Object.fromEntries(result.response.headers));
        response.end(Buffer.from(await result.response.arrayBuffer()));
      } catch (error) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ message: error instanceof Error ? error.message : String(error) }),
        );
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    if (reopenedClient) await reopenedClient.close();
    else if (dataDir && !originalClosed) await (await getPgliteClient()).close();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const directory of [dataDir, storageDir])
      if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("materializes exact field mappings and relations, and deduplicates fresh adapter retries", async () => {
    const first = await store().recordSent(message("Exhibition follow-up"), receipt("sent-first"), {
      contactId,
      date: "2026-10-23T01:00:00.000Z",
    });
    expect(first.status).toBe("applied");
    if (!first.recordId) throw new Error("Expected materialized record ID");
    const saved = await client().records.get({ recordId: first.recordId });
    expect(saved.headCommit.payload).toMatchObject({
      subject: "Exhibition follow-up",
      "event-key": first.externalKey,
      "event-type": "sent-choice",
      "event-date": "2026-10-23T01:00:00.000Z",
      "peer-email": "buyer@example.net",
      lead: [contactId],
      campaign: [campaignId],
      mailbox: "sales-mailbox",
      transport: "smtp",
      "rfc-id": "<sent-first@example.com>",
      "provider-id": "<sent-first@example.com>",
    });
    expect(saved.headCommit.payload.body).toContain("[View case]");
    const again = await store().recordSent(message("Exhibition follow-up"), receipt("sent-first"));
    expect(again).toMatchObject({ status: "duplicate", recordId: first.recordId });
    expect(writes.every(({ body }) => !Object.hasOwn(body, "autoMerge"))).toBe(true);
  });

  it("lets real credential ceilings keep incoming events pending and deduplicates concurrent proposals", async () => {
    const email = reply("pending-one");
    const concurrent = await Promise.all([
      store("proposer").recordReceived(email),
      store("proposer").recordReceived(email),
    ]);
    expect(concurrent[0]?.status).toBe("pending");
    expect(concurrent[1]?.changeRequestId).toBe(concurrent[0]?.changeRequestId);
    const pending = concurrent[0];
    if (!pending) throw new Error("Expected pending result");
    const retry = await store("proposer").recordReceived(email);
    expect(retry.changeRequestId).toBe(pending.changeRequestId);
    expect(
      await client().records.search({
        baseId: logsBaseId,
        fieldSlug: "event-key",
        valueText: pending.externalKey,
      }),
    ).toHaveLength(0);
    const actualDb = await getDb();
    const rows = await actualDb
      .select()
      .from(schema.busabaseChangeRequests)
      .where(
        and(
          eq(schema.busabaseChangeRequests.baseId, logsBaseId),
          eq(schema.busabaseChangeRequests.idempotencyKey, pending.externalKey),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("in_review");
  });

  it("loads the full canonical sent watch over real cursor pages and excludes replies and other accounts", async () => {
    for (const id of ["sent-second", "sent-third"])
      await store().recordSent(message(id), receipt(id));
    await store().recordReceived(reply("received-canonical"));
    const other = createBusabaseEmailStore({
      client: client(),
      baseId: logsBaseId,
      fields,
      values,
      campaignId,
      accountKey: "support-mailbox",
    });
    await other.recordSent(message("Support conversation"), receipt("sent-support"));
    const watch = await loadReplyWatch({
      client: client(),
      baseId: logsBaseId,
      fields: {
        type: fields.type,
        messageId: fields.messageId,
        providerMessageId: fields.providerMessageId,
        provider: fields.provider,
        contact: fields.contact,
        campaign: fields.campaign,
        account: fields.account,
      },
      sentValue: values.sent,
      campaignId,
      accountKey: "sales-mailbox",
      pageSize: 1,
    });
    expect(new Set(watch.messageIds)).toEqual(
      new Set([
        "<sent-first@example.com>",
        "<sent-second@example.com>",
        "<sent-third@example.com>",
      ]),
    );
    expect(watch.senders).toEqual(["buyer@example.net"]);
    expect(watch.sesMessageIds).toEqual([]);
  });

  it("recovers a durable checkpoint failure without duplicate records, retains pending IDs, then reloads the actual DB", async () => {
    const scope = "sales-mailbox/INBOX/77";
    const checkpointFile = path.join(storageDir, "email-checkpoint.json");
    const messages = [{ email: reply("checkpoint-pending"), uid: 10 }];
    const options = {
      scope,
      messages,
      record: ({ email }: { email: ReceivedEmail }) => store("proposer").recordReceived(email),
    };
    await expect(
      syncReceivedEmails({
        ...options,
        saveCheckpoint: async () => {
          throw new Error("Checkpoint volume unavailable");
        },
      }),
    ).rejects.toThrow("Checkpoint volume unavailable");
    const checkpoint = await syncReceivedEmails({
      ...options,
      saveCheckpoint: async (value) => {
        await writeFile(checkpointFile, JSON.stringify(value));
      },
    });
    const durableCheckpoint = JSON.parse(
      await readFile(checkpointFile, "utf8"),
    ) as InboxSyncCheckpoint;
    expect(durableCheckpoint).toEqual(checkpoint);
    expect(checkpoint.uid).toBe(10);
    expect(checkpoint.pendingChangeRequests).toHaveLength(1);
    const pendingId = checkpoint.pendingChangeRequests[0]?.changeRequestId;
    if (!pendingId) throw new Error("Expected durable pending proposal");
    await (await getPgliteClient()).close();
    originalClosed = true;
    reopenedClient = await PGlite.create(dataDir, { extensions: { pg_trgm } });
    const reopenedDb = drizzle({ client: reopenedClient, schema });
    hostDb = reopenedDb;
    const canonical = await client().records.list({ baseId: logsBaseId });
    expect(canonical.records).toHaveLength(5);
    const pendingRows = await reopenedDb
      .select()
      .from(schema.busabaseChangeRequests)
      .where(eq(schema.busabaseChangeRequests.id, pendingId));
    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0]?.status).toBe("in_review");
    const firstMessage = messages[0];
    if (!firstMessage) throw new Error("Expected recovery message");
    const recovered = await store("proposer").recordReceived(firstMessage.email);
    expect(recovered.changeRequestId).toBe(pendingId);
    const restarted = await syncReceivedEmails({
      ...options,
      checkpoint: durableCheckpoint,
      record: async () => {
        throw new Error("Already acknowledged message must not replay");
      },
      saveCheckpoint: async () => {
        throw new Error("No checkpoint write required");
      },
    });
    expect(restarted).toEqual(durableCheckpoint);
  }, 60_000);
});
