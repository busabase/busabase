import { describe, expect, it } from "vitest";
import { createBusabaseEmailStore } from "../src/busabase.js";
import { matchReply } from "../src/inbound/match.js";
import { parseEmail } from "../src/inbound/parser.js";
import { delayNotice, exmailBounce, gmailBounce } from "./fixtures/bounces.js";

describe("asynchronous bounce notices", () => {
  it("reads the failed recipient and original ID from a Tencent Exmail notice without a report", async () => {
    const email = await parseEmail(exmailBounce);
    expect(email.kind).toBe("bounce");
    expect(email.from).toEqual(["postmaster@example.com"]);
    expect(email.inReplyTo).toEqual([]);
    expect(email.bounce).toEqual({
      recipients: ["buyer@example.net"],
      originalMessageId: "<AB12CD34EF56AB78+outgoing-0001@example.com>",
    });
    // Watches store the ID returned at send time, before Exmail adds its prefix.
    expect(matchReply(email, { messageIds: ["<outgoing-0001@example.com>"] })).toEqual({
      matchedBy: "thread",
      repliesToMessageId: "<AB12CD34EF56AB78+outgoing-0001@example.com>",
    });
    expect(matchReply(email, { senders: ["buyer@example.net"] })?.matchedBy).toBe("sender");
    expect(
      matchReply(email, { messageIds: ["<other@example.com>"], senders: ["other@example.net"] }),
    ).toBeNull();
  });

  it("keeps only the recipients a notice names when the original went to several people", async () => {
    const email = await parseEmail(
      exmailBounce.replace("To: Buyer@Example.net", "To: colleague@example.net, Buyer@Example.net"),
    );
    expect(email.bounce?.recipients).toEqual(["buyer@example.net"]);

    const unnamed = await parseEmail(
      exmailBounce
        .replace("To: Buyer@Example.net", "To: colleague@example.net, Buyer@Example.net")
        .replace("<b>Buyer@Example.net</b>", "one recipient"),
    );
    // Still matched as a bounce by its original ID, but no address is guessed.
    expect(unnamed.bounce).toEqual({
      recipients: [],
      originalMessageId: "<AB12CD34EF56AB78+outgoing-0001@example.com>",
    });
  });

  it("keeps a recipient failed when its Action is missing or carries a comment", async () => {
    for (const action of ["", "Action: failed (permanent)\r\n"]) {
      const email = await parseEmail(gmailBounce.replace("Action: failed\r\n", action));
      expect(email.kind).toBe("bounce");
      expect(email.bounce?.recipients).toEqual(["missing@example.org"]);
    }
  });

  it("reads Final-Recipient and the original ID from an RFC 3464 report", async () => {
    const email = await parseEmail(gmailBounce);
    expect(email.kind).toBe("bounce");
    expect(email.bounce).toEqual({
      recipients: ["missing@example.org"],
      originalMessageId: "<AB12CD34EF56AB78+outgoing-0002@example.com>",
    });
    expect(matchReply(email, { messageIds: ["<outgoing-0002@example.com>"] })?.matchedBy).toBe(
      "thread",
    );
  });

  it("treats an Exmail notice that cites only temporary SMTP codes as a delay, not a bounce", async () => {
    const delayed = await parseEmail(
      exmailBounce.replace(
        "550 5.1.1 mailbox unavailable",
        "421 4.4.1 connection timed out, delivery will be retried",
      ),
    );
    expect(delayed.kind).toBe("auto-reply");
    expect(delayed.bounce).toBeUndefined();
    // With no code at all the notice stays a bounce: unknown is treated as failed.
    const uncoded = await parseEmail(
      exmailBounce.replace("host mx.example.net said: 550 5.1.1 mailbox unavailable", ""),
    );
    expect(uncoded.kind).toBe("bounce");
    expect(uncoded.bounce?.recipients).toEqual(["buyer@example.net"]);
  });

  it("treats a delay-only report as an automatic notice, not a failed address", async () => {
    const email = await parseEmail(delayNotice);
    expect(email.kind).toBe("auto-reply");
    expect(email.bounce).toBeUndefined();
  });

  it("records a bounce against the failed recipient instead of the mailer daemon", async () => {
    const writes: Record<string, unknown>[] = [];
    const store = createBusabaseEmailStore({
      client: {
        records: { search: async () => [] },
        bases: {
          createChangeRequest: async (input) => {
            writes.push(input.fields);
            return { id: "bounce-record", materialized: true };
          },
        },
      },
      baseId: "records",
      fields: { externalKey: "key", type: "kind", contact: "peer", from: "sender" },
      values: { bounce: "bounced" },
    });
    await store.recordReceived(await parseEmail(exmailBounce));
    expect(writes[0]).toMatchObject({
      kind: "bounced",
      peer: "buyer@example.net",
      sender: "postmaster@example.com",
    });
  });

  it("leaves ordinary replies without bounce details", async () => {
    const email = await parseEmail(
      [
        "From: buyer@example.net",
        "To: sales@example.com",
        "Subject: Re: Following up",
        "Message-ID: <reply@example.net>",
        "In-Reply-To: <outgoing-0001@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Final-Recipient: rfc822; someone@example.org",
      ].join("\r\n"),
    );
    expect(email.kind).toBe("reply");
    expect(email.bounce).toBeUndefined();
  });
});
