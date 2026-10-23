import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { SendRawEmailCommand, SendRawEmailCommandOutput } from "@aws-sdk/client-ses";
import { simpleParser } from "mailparser";
import { describe, expect, it, vi } from "vitest";
import { createSesTransport } from "../src/transports/ses.js";
import { createSmtpTransport } from "../src/transports/smtp.js";

const base = {
  from: "Sales <sales@example.com>",
  to: "Buyer <buyer@example.net>",
  subject: "销售助理 · Follow-up",
};

describe("SES transport", () => {
  it.each(
    ["retryable service failure", "lost acknowledgement"].flatMap((failure) => [
      { failure, setting: "omitted", config: {} },
      { failure, setting: "undefined", config: { maxAttempts: undefined } },
    ]),
  )(
    "does not automatically resend after $failure with maxAttempts $setting",
    async ({ failure, config }) => {
      let attempts = 0;
      const server = createServer(async (request, response) => {
        // Consume the submitted MIME before simulating a failure: it may already be delivered.
        for await (const _chunk of request) {
          // Drain the actual signed AWS SDK request.
        }
        attempts += 1;
        if (failure === "lost acknowledgement") {
          request.socket.destroy();
          return;
        }
        response.writeHead(500, { "Content-Type": "text/xml" });
        response.end(
          '<ErrorResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/"><Error><Type>Receiver</Type><Code>ServiceUnavailable</Code><Message>Retryable fixture failure</Message></Error><RequestId>fixture</RequestId></ErrorResponse>',
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const transport = createSesTransport({
        config: {
          ...config,
          endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          region: "us-east-1",
          credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
        },
      });
      try {
        await expect(transport.send({ ...base, text: "Send only once" })).rejects.toThrow();
        expect(attempts).toBe(1);
      } finally {
        await transport.close?.();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );

  it("composes real MIME with HTML, plaintext, attachment, reply headers, and private Bcc", async () => {
    const send = vi
      .fn<(command: SendRawEmailCommand) => Promise<SendRawEmailCommandOutput>>()
      .mockResolvedValue({ MessageId: "provider-id", $metadata: {} });
    const transport = createSesTransport({ client: { send }, configurationSetName: "outreach" });
    const result = await transport.send({
      ...base,
      cc: "cc@example.net",
      bcc: "private@example.net",
      markdown: "## Hello\n\n[→ Case study](https://example.com/case)",
      replyTo: "replies@example.com",
      inReplyTo: "<original@example.com>",
      references: ["<first@example.com>", "<original@example.com>"],
      headers: { "X-Campaign": "campaign-1" },
      tags: { campaign: "campaign-1" },
      attachments: [
        { filename: "资料.txt", content: Buffer.from("Material 内容"), contentType: "text/plain" },
      ],
    });
    const command = send.mock.calls[0]?.[0];
    expect(command?.input.Destinations).toEqual([
      "buyer@example.net",
      "cc@example.net",
      "private@example.net",
    ]);
    expect(command?.input.ConfigurationSetName).toBe("outreach");
    expect(command?.input.Tags).toEqual([{ Name: "campaign", Value: "campaign-1" }]);
    const data = command?.input.RawMessage?.Data;
    expect(data).toBeInstanceOf(Buffer);
    if (!data) throw new Error("Missing MIME data");
    const parsed = await simpleParser(Buffer.from(data));
    expect(parsed.subject).toBe(base.subject);
    expect(parsed.text).toContain("https://example.com/case");
    expect(parsed.html).toContain("<h2>Hello</h2>");
    expect(parsed.attachments[0]?.filename).toBe("资料.txt");
    expect(parsed.attachments[0]?.content.toString()).toBe("Material 内容");
    expect(parsed.inReplyTo).toBe("<original@example.com>");
    expect(parsed.references).toEqual(["<first@example.com>", "<original@example.com>"]);
    expect(parsed.replyTo?.value[0]?.address).toBe("replies@example.com");
    expect(parsed.headers.get("x-campaign")).toBe("campaign-1");
    expect(parsed.bcc).toBeUndefined();
    expect(result).toEqual({
      provider: "ses",
      providerMessageId: "provider-id",
      messageId: null,
      accepted: ["buyer@example.net", "cc@example.net", "private@example.net"],
      rejected: [],
    });
    await transport.close?.();
  });

  it("propagates SES rejection and does not claim delivery", async () => {
    const send = vi
      .fn<(command: SendRawEmailCommand) => Promise<SendRawEmailCommandOutput>>()
      .mockRejectedValue(new Error("MessageRejected"));
    const transport = createSesTransport({ client: { send } });
    await expect(transport.send({ ...base, text: "Hello" })).rejects.toThrow("MessageRejected");
    await transport.close?.();
  });

  it("rejects invalid headers before calling AWS", async () => {
    const send = vi.fn<(command: SendRawEmailCommand) => Promise<SendRawEmailCommandOutput>>();
    const transport = createSesTransport({ client: { send } });
    await expect(
      transport.send({ ...base, subject: "Hello\r\nBcc: x@example.com", text: "Hello" }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    await transport.close?.();
  });

  it("does not invent an RFC Message-ID or successful result from an incomplete SES response", async () => {
    const send = vi
      .fn<(command: SendRawEmailCommand) => Promise<SendRawEmailCommandOutput>>()
      .mockResolvedValue({ MessageId: "", $metadata: {} });
    const transport = createSesTransport({ client: { send } });
    await expect(transport.send({ ...base, text: "Hello" })).rejects.toThrow("MessageId");
    await transport.close?.();
  });
});

describe("SMTP transport", () => {
  it("validates before connecting to an SMTP server", async () => {
    const transport = createSmtpTransport({ host: "127.0.0.1", port: 1, connectionTimeout: 100 });
    await expect(
      transport.send({ ...base, to: "buyer@example.net\r\nBcc: x@example.net", text: "Hello" }),
    ).rejects.toThrow("CR");
    await transport.close?.();
  });
});
