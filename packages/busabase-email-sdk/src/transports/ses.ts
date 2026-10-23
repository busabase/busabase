import {
  SESClient,
  type SESClientConfig,
  SendRawEmailCommand,
  type SendRawEmailCommandOutput,
} from "@aws-sdk/client-ses";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { renderEmail } from "../render.js";
import type { EmailTransport } from "../types.js";

export interface SesTransportOptions {
  /** Omit credentials to use the AWS SDK's standard credential provider chain. */
  config?: SESClientConfig;
  client?: { send(command: SendRawEmailCommand): Promise<SendRawEmailCommandOutput> };
  configurationSetName?: string;
}

/** Compose one complete MIME message so SES also delivers attachments and threading headers. */
export const createSesTransport = (options: SesTransportOptions = {}): EmailTransport => {
  // Raw sends have no provider idempotency token: a lost acknowledgement must not resend silently.
  const ownedClient = options.client
    ? undefined
    : new SESClient({ ...options.config, maxAttempts: options.config?.maxAttempts ?? 1 });
  const client = options.client ?? ownedClient;
  if (!client) throw new Error("SES client is required");
  return {
    send: async (message) => {
      const rendered = await renderEmail(message);
      const mime = new MailComposer({
        ...rendered,
        disableFileAccess: true,
        disableUrlAccess: true,
      }).compile();
      // MailComposer strips Bcc headers by default while retaining envelope recipients.
      // StreamTransport cannot be used here: it unconditionally keeps Bcc in raw MIME.
      const envelope = mime.getEnvelope();
      if (!envelope.from) throw new Error("SES requires a sender address");
      const raw = await mime.build();
      const result = await client.send(
        new SendRawEmailCommand({
          RawMessage: { Data: raw },
          Source: envelope.from,
          Destinations: envelope.to,
          ConfigurationSetName: options.configurationSetName,
          Tags: message.tags
            ? Object.entries(message.tags).map(([Name, Value]) => ({ Name, Value }))
            : undefined,
        }),
      );
      if (!result.MessageId)
        throw new Error("SES accepted the request without returning a MessageId");
      return {
        provider: "ses",
        providerMessageId: result.MessageId,
        // SES replaces Date and Message-ID. The locally composed ID is not the delivered ID.
        messageId: null,
        accepted: envelope.to,
        rejected: [],
      };
    },
    close: () => {
      ownedClient?.destroy();
    },
  };
};
