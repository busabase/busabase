import { afterEach, describe, expect, it } from "vitest";
import { MailboxResetError, readImapReplies } from "../src/inbound/imap.js";
import { mailboxFixture } from "./fixtures/imap.js";

describe("IMAP real socket round-trip", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((close) => close()));
  });

  it("reads with EXAMINE/PEEK, batches ascending UIDs including unmatched mail, and resumes without loss", async () => {
    const fixture = await mailboxFixture();
    cleanups.push(fixture.close);
    const watch = { messageIds: ["<sent@example.com>"], senders: ["buyer@example.net"] };
    const first = await readImapReplies(fixture.config, { watch, limit: 2 });
    expect(first.messages.map((entry) => entry.uid)).toEqual([2, 5]);
    expect(first.messages[0]?.match).toBeNull();
    expect(first.messages[1]?.match?.matchedBy).toBe("sender+thread");
    expect(first.cursor).toEqual({ mailbox: "INBOX", uidValidity: "77", uid: 5 });
    const second = await readImapReplies(fixture.config, { watch, cursor: first.cursor, limit: 2 });
    expect(second.messages.map((entry) => entry.uid)).toEqual([9]);
    const empty = await readImapReplies(fixture.config, { watch, cursor: second.cursor });
    expect(empty.messages).toEqual([]);
    expect(empty.cursor.uid).toBe(9);
    expect(fixture.commands.some((line) => line.includes("EXAMINE"))).toBe(true);
    expect(
      fixture.commands
        .filter((line) => line.includes("UID FETCH"))
        .every((line) => line.includes("BODY.PEEK[]")),
    ).toBe(true);
    expect(fixture.commands.some((line) => /\bSTORE\b/.test(line))).toBe(false);
    expect(fixture.commands.filter((line) => line.includes("LOGOUT"))).toHaveLength(3);
  }, 15000);

  it("rejects stale UIDVALIDITY explicitly and disconnects on failure", async () => {
    const fixture = await mailboxFixture();
    cleanups.push(fixture.close);
    await expect(
      readImapReplies(fixture.config, {
        watch: {},
        cursor: { mailbox: "INBOX", uidValidity: "1", uid: 500 },
      }),
    ).rejects.toBeInstanceOf(MailboxResetError);
    expect(fixture.commands.some((line) => line.includes("LOGOUT"))).toBe(true);
    expect(fixture.commands.some((line) => line.includes("UID SEARCH"))).toBe(false);
  }, 15000);
});
