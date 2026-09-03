import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * The server-side half of `@` mentions on `comments.create`.
 *
 * The two facts worth a database to prove:
 *
 * 1. **A forged DTO cannot start an agent.** `comments.create` is classified
 *    `node("write")`, but an agent mention reaches a capability the agents
 *    router guards at workspace `write`. The picker hiding agent rows is UI,
 *    not authorization — so this asserts the server refuses, and refuses
 *    LOUDLY rather than by silently dropping the mention.
 * 2. **Dispatch never damages the comment.** A mention pointing at an agent
 *    that cannot start leaves the comment intact and the mention `failed`, not
 *    an error and not an eternal `queued`.
 *
 * Every agent mention here uses a slug deliberately absent from the catalog, so
 * `resolveLaunch` refuses it immediately. A real slug would `npx`-download an
 * agent from inside a unit test.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const MISSING_AGENT = "test-missing-agent";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("comment @ mentions — oRPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let blogBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-mention-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-mention-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
    const bases = await client.bases.list({});
    blogBaseId = bases.find((base) => base.slug === "blog")?.id ?? "";
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  const openCr = (title: string) =>
    client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields: { title, body: "v1", channel: "blog" },
      message: "Initial",
      submittedBy: "mention-test",
      autoMerge: false,
    });

  it("rejects a forged agent mention from an actor below the agents floor", async () => {
    const cr = await openCr("Forged agent mention");

    // `changeRequest` clears comment-write on the node but is below the agents
    // floor. The picker would never have offered an agent here; this call skips
    // the UI entirely, which is exactly the bypass the guard exists for.
    await runWithBusabaseContext({ permissionLevel: "changeRequest" }, async () => {
      await expect(
        client.comments.create({
          subjectType: "change_request",
          subjectId: cr.id,
          body: "@Codex do it",
          mentions: [{ type: "agent", id: MISSING_AGENT, start: 0, end: 6 }],
        }),
      ).rejects.toThrow(/Requires write workspace access/i);
    });

    // Refused, not partially applied: no comment was written at all.
    const listed = await client.comments.list({
      subjectType: "change_request",
      subjectId: cr.id,
    });
    expect(listed).toHaveLength(0);
  });

  it("still lets the same actor post a comment that mentions only people", async () => {
    const cr = await openCr("Member mention below the agents floor");
    await runWithBusabaseContext({ permissionLevel: "changeRequest" }, async () => {
      const created = await client.comments.create({
        subjectType: "change_request",
        subjectId: cr.id,
        body: "@Alice can you look?",
        mentions: [{ type: "member", id: "local-editor", start: 0, end: 6 }],
      });
      expect(created.mentions).toHaveLength(1);
    });
  });

  it("keeps the comment and marks the mention failed when the agent cannot start", async () => {
    const cr = await openCr("Agent that cannot start");
    const created = await client.comments.create({
      subjectType: "change_request",
      subjectId: cr.id,
      body: "@Codex please revise",
      mentions: [{ type: "agent", id: MISSING_AGENT, start: 0, end: 6 }],
    });

    expect(created.body).toBe("@Codex please revise");
    const mention = created.mentions[0];
    // Never left sitting in `queued` — the user gets a named reason.
    expect(mention?.dispatchStatus).toBe("failed");
    expect(mention?.error).toMatch(/test-missing-agent/i);
    expect(mention?.sessionId).toBeNull();

    // And it survives a reload rather than only existing in the create response.
    const listed = await client.comments.list({
      subjectType: "change_request",
      subjectId: cr.id,
    });
    expect(listed.find((c) => c.id === created.id)?.mentions[0]?.dispatchStatus).toBe("failed");
  });

  it("pre-stamps readAt on a self-mention so it never inflates your own unread count", async () => {
    const cr = await openCr("Self mention");
    const { busabaseCommentMentions } = await import("../src/db/schema");
    const { getDb } = await import("../src/db");
    const { eq } = await import("drizzle-orm");

    const created = await client.comments.create({
      subjectType: "change_request",
      subjectId: cr.id,
      authorId: "local-admin",
      body: "@me and @you",
      mentions: [
        { type: "member", id: "local-admin", start: 0, end: 3 },
        { type: "member", id: "local-editor", start: 8, end: 12 },
      ],
    });

    const db = await getDb();
    const rows = await db
      .select()
      .from(busabaseCommentMentions)
      .where(eq(busabaseCommentMentions.commentId, created.id));
    const self = rows.find((row) => row.targetId === "local-admin");
    const other = rows.find((row) => row.targetId === "local-editor");
    expect(self?.readAt).not.toBeNull();
    expect(other?.readAt).toBeNull();
  });

  it("collapses a duplicated agent mention to one row, keeping duplicated members", async () => {
    const cr = await openCr("Duplicates");
    const created = await client.comments.create({
      subjectType: "change_request",
      subjectId: cr.id,
      body: "@Codex @Codex @Alice @Alice",
      mentions: [
        { type: "agent", id: MISSING_AGENT, start: 0, end: 6 },
        { type: "agent", id: MISSING_AGENT, start: 7, end: 13 },
        { type: "member", id: "local-editor", start: 14, end: 20 },
        { type: "member", id: "local-editor", start: 21, end: 27 },
      ],
    });

    expect(created.mentions.filter((m) => m.type === "agent")).toHaveLength(1);
    expect(created.mentions.filter((m) => m.type === "member")).toHaveLength(2);
  });

  it("rejects a span that would split a surrogate pair", async () => {
    const cr = await openCr("Surrogate pair");
    const body = "🎉 @Alice";
    await expect(
      client.comments.create({
        subjectType: "change_request",
        subjectId: cr.id,
        body,
        // Starts between the two halves of the emoji.
        mentions: [{ type: "member", id: "local-editor", start: 1, end: 5 }],
      }),
    ).rejects.toThrow(/surrogate/i);
  });

  it("round-trips spans through a CJK body with an emoji in front of the mention", async () => {
    const cr = await openCr("CJK round trip");
    const body = "论点很扎实 🎉 @Alice 请复核这一行。";
    const start = body.indexOf("@Alice");
    const created = await client.comments.create({
      subjectType: "change_request",
      subjectId: cr.id,
      body,
      mentions: [{ type: "member", id: "local-editor", start, end: start + 6 }],
    });

    const listed = await client.comments.list({
      subjectType: "change_request",
      subjectId: cr.id,
    });
    const found = listed.find((c) => c.id === created.id);
    expect(found?.body).toBe(body);
    const mention = found?.mentions[0];
    expect([mention?.start, mention?.end]).toEqual([start, start + 6]);
    expect(body.slice(mention?.start ?? 0, mention?.end ?? 0)).toBe("@Alice");
  });

  it("leaves a pre-migration-style body containing '@ai' as ordinary text", async () => {
    const cr = await openCr("Plain @ai text");
    const created = await client.comments.create({
      subjectType: "change_request",
      subjectId: cr.id,
      body: "I typed @ai out of habit",
      // No mentions: the server never regexes the body for a target.
    });
    expect(created.body).toBe("I typed @ai out of habit");
    expect(created.mentions).toEqual([]);
  });
});
