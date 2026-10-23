import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { SESClient } from "@aws-sdk/client-ses";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";
import { describe, expect, it } from "vitest";
import { createSesTransport } from "../src/transports/ses.js";
import { createSmtpTransport } from "../src/transports/smtp.js";

describe("real local delivery protocols", () => {
  it("delivers multipart SMTP with visible links, exact attachment bytes and partial recipient results", async () => {
    const received: Buffer[] = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["AUTH", "STARTTLS"],
      onRcptTo: (address, _session, callback) => {
        callback(
          address.address === "missing@example.net"
            ? Object.assign(new Error("Unknown recipient"), { responseCode: 550 })
            : undefined,
        );
      },
      onData: (stream, _session, callback) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.once("end", () => {
          received.push(Buffer.concat(chunks));
          callback();
        });
        stream.once("error", callback);
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const transport = createSmtpTransport({
      host: "127.0.0.1",
      port: (server.server.address() as AddressInfo).port,
      secure: false,
      ignoreTLS: true,
    });
    try {
      const bytes = Buffer.from([0, 1, 2, 250, 255]);
      const result = await transport.send({
        from: "Team <sales@example.com>",
        to: ["buyer@example.net", "missing@example.net"],
        bcc: "archive@example.com",
        replyTo: "sales@example.com",
        subject: "AI for your business",
        markdown:
          "## Your next step\n\n**[→ View the case](https://example.com/article#section-2)**",
        inReplyTo: "<earlier@example.net>",
        references: ["<earlier@example.net>"],
        attachments: [{ filename: "report.bin", content: bytes }],
      });
      expect(result.accepted).toEqual(["buyer@example.net", "archive@example.com"]);
      expect(result.rejected).toEqual(["missing@example.net"]);
      const raw = received[0];
      if (!raw) throw new Error("SMTP fixture did not receive a message");
      const parsed = await simpleParser(raw);
      expect(parsed.messageId).toBe(result.messageId);
      expect(parsed.bcc).toBeUndefined();
      expect(parsed.text).toContain("→ View the case");
      expect(parsed.text).toContain("https://example.com/article#section-2");
      expect(parsed.html).toContain('<strong><a href="https://example.com/article#section-2"');
      expect(parsed.inReplyTo).toBe("<earlier@example.net>");
      expect(parsed.replyTo?.value[0]?.address).toBe("sales@example.com");
      expect(parsed.attachments[0]?.content).toEqual(bytes);
    } finally {
      await transport.close?.();
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });

  it("uses the actual SES SDK over HTTP, preserves MIME, and separates SES and RFC identifiers", async () => {
    let sentMime: Buffer | undefined;
    let recipients: string[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const params = new URLSearchParams(body);
      expect(params.get("Action")).toBe("SendRawEmail");
      sentMime = Buffer.from(params.get("RawMessage.Data") ?? "", "base64");
      recipients = [...params.entries()]
        .filter(([key]) => key.startsWith("Destinations.member."))
        .map(([, value]) => value);
      response.setHeader("Content-Type", "text/xml");
      response.end(
        '<SendRawEmailResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><SendRawEmailResult><MessageId>ses-fixture-id</MessageId></SendRawEmailResult><ResponseMetadata><RequestId>fixture</RequestId></ResponseMetadata></SendRawEmailResponse>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const client = new SESClient({
      region: "us-east-1",
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
      maxAttempts: 1,
    });
    const transport = createSesTransport({ client });
    try {
      const result = await transport.send({
        from: "sales@example.com",
        to: "buyer@example.net",
        bcc: "archive@example.com",
        replyTo: "sales@example.com",
        subject: "SES protocol",
        markdown: "[→ More](https://example.com/#case)",
        attachments: [{ filename: "hello.txt", content: "hello" }],
      });
      expect(result).toMatchObject({
        provider: "ses",
        providerMessageId: "ses-fixture-id",
        messageId: null,
      });
      expect(recipients).toEqual(["buyer@example.net", "archive@example.com"]);
      if (!sentMime) throw new Error("SES fixture did not receive MIME content");
      const parsed = await simpleParser(sentMime);
      expect(parsed.bcc).toBeUndefined();
      expect(parsed.attachments[0]?.content.toString()).toBe("hello");
      expect(parsed.text).toContain("https://example.com/#case");
      expect(parsed.replyTo?.value[0]?.address).toBe("sales@example.com");
    } finally {
      client.destroy();
      await transport.close?.();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
