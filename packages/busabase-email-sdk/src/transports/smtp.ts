import type { ConnectionOptions } from "node:tls";
import nodemailer from "nodemailer";
import { renderEmail } from "../render.js";
import type { EmailTransport } from "../types.js";

export interface SmtpTransportConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  service?: string;
  name?: string;
  auth?:
    | { type?: "login"; user: string; pass: string }
    | {
        type: "OAuth2";
        user: string;
        clientId?: string;
        clientSecret?: string;
        refreshToken?: string;
        accessToken?: string;
        expires?: number;
        serviceClient?: string;
        privateKey?: string;
        accessUrl?: string;
      };
  tls?: ConnectionOptions;
  requireTLS?: boolean;
  ignoreTLS?: boolean;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
}

/** Supports ordinary SMTP and Amazon SES SMTP credentials. */
export const createSmtpTransport = (config: SmtpTransportConfig): EmailTransport => {
  const transport = nodemailer.createTransport({
    ...config,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    send: async (message) => {
      const rendered = await renderEmail(message);
      const info = await transport.sendMail({
        ...rendered,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const address = (value: string | { address: string }): string =>
        typeof value === "string" ? value : value.address;
      return {
        provider: "smtp",
        providerMessageId: info.messageId,
        messageId: info.messageId,
        accepted: (info.accepted ?? []).map(address),
        rejected: (info.rejected ?? []).map(address),
      };
    },
    close: () => transport.close(),
  };
};
