import { describe, expect, it } from "vitest";
import { matchReply } from "../src/inbound/match.js";
import { parseEmail, stripQuotedText } from "../src/inbound/parser.js";
import { parseSesInbound, parseSesNotification } from "../src/inbound/ses.js";

const mime = [
  "From: Buyer <buyer@example.net>",
  "To: sales@example.com",
  "Subject: Re: Follow-up",
  "Message-ID: <reply@example.net>",
  "In-Reply-To: <AABBCCDD0011+original@example.com>",
  "References: <first@example.com>",
  " <AABBCCDD0011+original@example.com>",
  "Date: Thu, 22 Oct 2026 12:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="parts"',
  "",
  "--parts",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Please send a proposal.",
  "",
  "On Wed, Sales wrote:",
  "> Old message",
  "--parts",
  'Content-Type: application/pdf; name="brief.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="brief.pdf"',
  "",
  "JVBERi1maXh0dXJl",
  "--parts--",
  "",
].join("\r\n");

describe("MIME reply parsing and matching", () => {
  it("decodes multipart MIME, folded references and attachments, preserving complete text and a reply preview", async () => {
    const email = await parseEmail(mime);
    expect(email.from).toEqual(["buyer@example.net"]);
    expect(email.text).toContain("Please send a proposal.");
    expect(email.text).toContain("> Old message");
    expect(email.replyText).toBe("Please send a proposal.");
    expect(email.attachments[0]?.content.toString()).toBe("%PDF-fixture");
    expect(email.references).toEqual([
      "<first@example.com>",
      "<AABBCCDD0011+original@example.com>",
    ]);
    expect(matchReply(email, { messageIds: ["<original@example.com>"] })).toEqual({
      matchedBy: "thread",
      repliesToMessageId: "<AABBCCDD0011+original@example.com>",
    });
    expect(
      matchReply(email, { senders: ["@example.net"], messageIds: ["<original@example.com>"] })
        ?.matchedBy,
    ).toBe("sender+thread");
    expect(matchReply(email, { senders: ["BUYER@example.net"] })?.matchedBy).toBe("sender");
    expect(matchReply(email, { senders: ["@other.net"] })).toBeNull();
  });

  it("preserves inline answers in text-only messages even when quote trimming misses them", async () => {
    const text =
      "Answers below.\r\n\r\nOn Thu, Sales wrote:\r\n> What date works?\r\nTuesday at 10 works.";
    const email = await parseEmail(
      [
        "From: buyer@example.net",
        "To: sales@example.com",
        "Subject: Answers",
        "Message-ID: <inline@example.net>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        text,
      ].join("\r\n"),
    );
    expect(email.text).toContain("Tuesday at 10 works.");
    expect(email.replyText).toBe("Answers below.");
    expect(email.html).toBeNull();
  });

  it("matches raw SES identifiers only against actual amazonses.com reference domains", async () => {
    const email = await parseEmail(mime);
    const watch = { sesMessageIds: ["provider-id"] };
    expect(
      matchReply(
        { ...email, references: [], inReplyTo: ["<provider-id@email.amazonses.com>"] },
        watch,
      )?.matchedBy,
    ).toBe("thread");
    for (const id of [
      "<provider-id@example.com>",
      "<provider-id@amazonses.com.attacker.net>",
      "<provider-id@fakeamazonses.com>",
    ]) {
      expect(matchReply({ ...email, references: [], inReplyTo: [id] }, watch)).toBeNull();
    }
  });

  it("preserves substantive blockquotes and non-history Chinese text", () => {
    expect(stripQuotedText("A proposal:\n> Our next step\nPlease confirm.")).toContain(
      "> Our next step",
    );
    expect(stripQuotedText("可以聊聊。\n\n于 2026年10月22日 销售 写道：\n> 历史邮件")).toBe(
      "可以聊聊。",
    );
    expect(stripQuotedText("We wrote: a new proposal")).toBe("We wrote: a new proposal");
  });

  it("classifies automatic replies and delivery-status reports without calling bulk mail an autoreply", async () => {
    expect((await parseEmail(`Auto-Submitted: auto-replied\r\n${mime}`)).kind).toBe("auto-reply");
    expect((await parseEmail(`Precedence: bulk\r\n${mime}`)).kind).toBe("reply");
    expect(
      (
        await parseEmail(
          'From: delivery@example.net\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nFailed\r\n--b--',
        )
      ).kind,
    ).toBe("bounce");
  });
});

describe("SES parsers (caller verifies webhook signatures)", () => {
  const mail = {
    messageId: "ses-id",
    destination: ["buyer@example.net"],
    timestamp: "2026-10-22T12:00:00Z",
  };
  it("normalizes delivery, bounce, complaint, open, and click events", () => {
    expect(
      parseSesNotification({
        Message: JSON.stringify({
          notificationType: "Bounce",
          mail,
          bounce: {
            bounceType: "Permanent",
            bouncedRecipients: [{ emailAddress: "failed@example.net" }],
          },
        }),
      }),
    ).toMatchObject({
      type: "bounce",
      providerMessageId: "ses-id",
      bounceType: "Permanent",
      recipients: ["failed@example.net"],
    });
    expect(
      parseSesNotification({
        eventType: "Delivery",
        mail,
        delivery: { recipients: ["buyer@example.net"] },
      }),
    ).toMatchObject({ type: "delivery", recipients: ["buyer@example.net"] });
    expect(
      parseSesNotification({
        eventType: "Complaint",
        mail,
        complaint: {
          complaintFeedbackType: "abuse",
          complainedRecipients: [{ emailAddress: "buyer@example.net" }],
        },
      }),
    ).toMatchObject({ type: "complaint", complaintFeedbackType: "abuse" });
    expect(
      parseSesNotification({ eventType: "Open", mail, open: { ipAddress: "192.0.2.1" } }),
    ).toMatchObject({ type: "open", ipAddress: "192.0.2.1" });
    expect(
      parseSesNotification({
        eventType: "Click",
        mail,
        click: { link: "https://example.com/case#details" },
      }),
    ).toMatchObject({ type: "click", url: "https://example.com/case#details" });
    expect(() => parseSesNotification({ eventType: "Unknown", mail })).toThrow("Unsupported");
  });
  it("parses actual MIME; returns an explicit S3 fetch request rather than fabricating an email from headers", async () => {
    expect(await parseSesInbound({ content: mime })).toMatchObject({
      kind: "email",
      email: {
        replyText: "Please send a proposal.",
        text: expect.stringContaining("> Old message"),
      },
    });
    expect(await parseSesInbound(Buffer.from(mime))).toMatchObject({ kind: "email" });
    const notification = {
      Records: [
        {
          ses: {
            mail,
            receipt: {
              action: { type: "S3", bucketName: "inbound-fixture", objectKey: "mail/ses-id" },
            },
          },
        },
      ],
    };
    expect(await parseSesInbound(notification)).toEqual({
      kind: "s3",
      bucket: "inbound-fixture",
      key: "mail/ses-id",
      providerMessageId: "ses-id",
    });
    await expect(parseSesInbound({ Records: [{ ses: { mail, receipt: {} } }] })).rejects.toThrow(
      "Fetch the raw message from S3",
    );
    await expect(
      parseSesInbound({ Records: [notification.Records[0], notification.Records[0]] }),
    ).rejects.toThrow("individually");
  });
});
