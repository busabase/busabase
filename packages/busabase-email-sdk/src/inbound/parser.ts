import { simpleParser } from "mailparser";
import type { ReceivedEmail, ReceivedEmailKind } from "../types.js";

/** Remove only recognizable history boundaries; a standalone blockquote may be new content. */
export const stripQuotedText = (text: string): string => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const boundary = lines.findIndex((line, index) => {
    const value = line.trim();
    return (
      /^On .+wrote:\s*$/i.test(value) ||
      /^-{2,}\s*(?:Original Message|Forwarded message|原始邮件|原邮件)\s*-{2,}$/i.test(value) ||
      /^(?:在|于)\s*.+(?:写道|寫道)[：:]\s*$/.test(value) ||
      (/^_{5,}$/.test(value) && /^From:\s*.+/i.test(lines[index + 1] ?? ""))
    );
  });
  return (boundary < 0 ? lines : lines.slice(0, boundary)).join("\n").trim();
};

export const splitMessageIds = (value: string | string[] | undefined): string[] => {
  return (Array.isArray(value) ? value : [value ?? ""]).flatMap(
    (part) => part.match(/<[^<>\s]+>/g) ?? [],
  );
};

export const parseEmail = async (raw: Buffer | string): Promise<ReceivedEmail> => {
  const parsed = await simpleParser(raw);
  const header = (name: string) => String(parsed.headers.get(name) ?? "");
  const from =
    parsed.from?.value.flatMap((entry) => (entry.address ? [entry.address.toLowerCase()] : [])) ??
    [];
  const to = (Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : []).flatMap(
    (entry) =>
      entry.value.flatMap((address) => (address.address ? [address.address.toLowerCase()] : [])),
  );
  const contentType = parsed.headerLines.find((entry) => entry.key === "content-type")?.line ?? "";
  let kind: ReceivedEmailKind = "reply";
  if (
    from.some((address) => /^(?:mailer-daemon|postmaster)@/i.test(address)) ||
    /multipart\/report[\s\S]*report-type\s*=\s*"?delivery-status/i.test(contentType) ||
    parsed.attachments.some((attachment) => attachment.contentType === "message/delivery-status")
  )
    kind = "bounce";
  else if (
    /^auto-(?:replied|generated)\b/i.test(header("auto-submitted")) ||
    parsed.headers.has("x-autoreply") ||
    parsed.headers.has("x-autorespond") ||
    /^auto_reply\b/i.test(header("precedence"))
  )
    kind = "auto-reply";

  return {
    messageId: parsed.messageId ?? null,
    from,
    to,
    subject: parsed.subject ?? "",
    date: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : null,
    inReplyTo: splitMessageIds(parsed.inReplyTo),
    references: splitMessageIds(parsed.references),
    text: parsed.text ?? "",
    replyText: stripQuotedText(parsed.text ?? ""),
    html: typeof parsed.html === "string" ? parsed.html : null,
    kind,
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename ?? null,
      contentType: attachment.contentType,
      content: attachment.content,
      size: attachment.size,
    })),
  };
};
