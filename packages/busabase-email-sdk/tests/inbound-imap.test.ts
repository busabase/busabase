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

  it("downloads a batch in chunked UID FETCH commands, not one round trip per message", async () => {
    // 33 UIDs listed by SEARCH: the three stored messages plus 30 expunged before FETCH.
    const expunged = Array.from({ length: 30 }, (_, index) => index + 10);
    const fixture = await mailboxFixture({ expunged });
    cleanups.push(fixture.close);
    const batch = await readImapReplies(fixture.config, {
      watch: { messageIds: ["<sent@example.com>"] },
    });
    expect(batch.messages.map((entry) => entry.uid)).toEqual([2, 5, 9]);
    expect(batch.messages[1]?.match?.matchedBy).toBe("thread");
    // Expunged mail is acknowledged, so the cursor still moves past it.
    expect(batch.cursor.uid).toBe(39);
    expect(fixture.commands.filter((line) => line.includes("UID FETCH"))).toHaveLength(2);
  }, 15000);

  it("in matched mode downloads only mail its headers match, plus anything that looks like a bounce", async () => {
    const bounce =
      "From: postmaster@example.com\r\nTo: sales@example.com\r\nSubject: Undeliverable\r\nMessage-ID: <notice@example.com>\r\nContent-Type: text/plain\r\n\r\nYour message could not be delivered.";
    const fixture = await mailboxFixture({ extra: [[12, bounce]] });
    cleanups.push(fixture.close);
    const batch = await readImapReplies(fixture.config, {
      watch: { messageIds: ["<sent@example.com>"] },
      download: "matched",
    });
    expect(batch.messages.map((entry) => entry.uid)).toEqual([2, 5, 9, 12]);
    expect(batch.messages.map((entry) => entry.match?.matchedBy ?? null)).toEqual([
      null,
      "thread",
      null,
      null,
    ]);
    // Unmatched mail keeps its headers but not its body.
    expect(batch.messages[0]?.email.subject).toBe("Other");
    expect(batch.messages[0]?.email.text).toBe("");
    expect(batch.messages[1]?.email.text).toContain("Yes please.");
    // A bounce may name the original only in its body, so it is always downloaded.
    expect(batch.messages[3]?.email.text).toContain("could not be delivered");
    const fetches = fixture.commands.filter((line) => line.includes("UID FETCH"));
    expect(fetches.filter((line) => line.includes("BODY.PEEK[HEADER]"))).toHaveLength(1);
    expect(fetches.filter((line) => line.includes("BODY.PEEK[]"))).toEqual([
      expect.stringMatching(/UID FETCH 5,12 /),
    ]);
    expect(batch.cursor.uid).toBe(12);
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
