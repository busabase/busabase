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
 * The Inbox's Mentions tab — the read half of `@`-mentioning a teammate.
 *
 * The write half already stores every mention with a nullable `readAt`; these
 * assertions cover the four rules that decide whether the badge tells the
 * truth:
 *
 * 1. A comment naming you twice is ONE entry, not two.
 * 2. Reading it clears BOTH of its rows, so the badge cannot get stuck.
 * 3. A self-mention never counts as unread (pre-stamped at write time — this
 *    proves the read path actually honours that rather than recomputing it).
 * 4. The row links to the comment's own context, per subject type.
 *
 * Real database, real router: the grouping and the counting are SQL, so a
 * mocked store would prove nothing about either.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const ME = "inbox-me";
const SOMEONE_ELSE = "inbox-teammate";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("mention inbox", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let blogBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-inbox-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-inbox-storage-"));
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
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const openCr = (title: string) =>
    client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields: { title, body: "v1", channel: "blog" },
      message: "Initial",
      submittedBy: "inbox-test",
      autoMerge: false,
    });

  /** Post as `author`, which is what makes "someone else mentioned me" real. */
  const commentAs = (
    author: string,
    subjectId: string,
    body: string,
    mentions: { type: "member" | "agent"; id: string; start: number; end: number }[],
  ) =>
    runWithBusabaseContext({ actorId: author }, () =>
      client.comments.create({
        subjectType: "change_request",
        subjectId,
        body,
        authorId: author,
        mentions,
      }),
    );

  const inboxAs = (actorId: string) =>
    runWithBusabaseContext({ actorId }, () =>
      client.comments.listMentions({ page: 1, pageSize: 50 }),
    );

  it("shows a comment a teammate mentioned me in, and counts it unread", async () => {
    const cr = await openCr("Mentioned once");
    await commentAs(SOMEONE_ELSE, cr.id, "@me take a look", [
      { type: "member", id: ME, start: 0, end: 3 },
    ]);

    const inbox = await inboxAs(ME);
    const entry = inbox.items.find((item) => item.body === "@me take a look");
    expect(entry).toBeDefined();
    expect(entry?.unread).toBe(true);
    expect(entry?.authorId).toBe(SOMEONE_ELSE);
    expect(inbox.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it("collapses a comment that mentions me twice into ONE entry", async () => {
    const cr = await openCr("Mentioned twice");
    const body = "@me at the top and @me at the bottom";
    await commentAs(SOMEONE_ELSE, cr.id, body, [
      { type: "member", id: ME, start: 0, end: 3 },
      { type: "member", id: ME, start: 19, end: 22 },
    ]);

    const inbox = await inboxAs(ME);
    // Two mention rows exist (each chip needs its own span) but they are one
    // thing to go read.
    expect(inbox.items.filter((item) => item.body === body)).toHaveLength(1);
  });

  it("clears BOTH rows when a twice-mentioning comment is opened", async () => {
    const cr = await openCr("Read clears every row");
    const body = "@me first and @me second";
    const comment = await commentAs(SOMEONE_ELSE, cr.id, body, [
      { type: "member", id: ME, start: 0, end: 3 },
      { type: "member", id: ME, start: 14, end: 17 },
    ]);

    const before = await inboxAs(ME);
    const marked = await runWithBusabaseContext({ actorId: ME }, () =>
      client.comments.markMentionsRead({ commentId: comment.id }),
    );

    // Both rows, not one — a half-cleared comment would keep the badge
    // counting something the reader has already read.
    expect(marked.marked).toBe(2);
    expect(marked.unreadCount).toBe(before.unreadCount - 1);

    const after = await inboxAs(ME);
    expect(after.items.find((item) => item.commentId === comment.id)?.unread).toBe(false);
  });

  it("is idempotent: opening an already-read comment marks nothing further", async () => {
    const cr = await openCr("Idempotent read");
    const comment = await commentAs(SOMEONE_ELSE, cr.id, "@me once", [
      { type: "member", id: ME, start: 0, end: 3 },
    ]);
    await runWithBusabaseContext({ actorId: ME }, () =>
      client.comments.markMentionsRead({ commentId: comment.id }),
    );
    const second = await runWithBusabaseContext({ actorId: ME }, () =>
      client.comments.markMentionsRead({ commentId: comment.id }),
    );
    expect(second.marked).toBe(0);
  });

  it("never counts a self-mention as unread", async () => {
    const cr = await openCr("Self mention");
    const before = await inboxAs(ME);
    await commentAs(ME, cr.id, "@me note to self", [{ type: "member", id: ME, start: 0, end: 3 }]);

    const after = await inboxAs(ME);
    // The entry exists (you did mention yourself, the chip renders) but it must
    // not inflate your own badge.
    expect(after.items.find((item) => item.body === "@me note to self")).toBeDefined();
    expect(after.items.find((item) => item.body === "@me note to self")?.unread).toBe(false);
    expect(after.unreadCount).toBe(before.unreadCount);
  });

  it("does not show me mentions addressed to someone else", async () => {
    const cr = await openCr("Not for me");
    await commentAs(ME, cr.id, "@teammate over to you", [
      { type: "member", id: SOMEONE_ELSE, start: 0, end: 9 },
    ]);

    const inbox = await inboxAs(ME);
    expect(inbox.items.find((item) => item.body === "@teammate over to you")).toBeUndefined();
    // …and the person it WAS addressed to does see it.
    const theirs = await inboxAs(SOMEONE_ELSE);
    expect(theirs.items.find((item) => item.body === "@teammate over to you")).toBeDefined();
  });

  it("links a change-request comment to that change request", async () => {
    const cr = await openCr("Link target");
    await commentAs(SOMEONE_ELSE, cr.id, "@me check the diff", [
      { type: "member", id: ME, start: 0, end: 3 },
    ]);

    const inbox = await inboxAs(ME);
    const entry = inbox.items.find((item) => item.body === "@me check the diff");
    expect(entry?.href).toBe(`/inbox/${cr.id}`);
  });
});
