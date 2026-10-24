import { type ParsedMail, simpleParser } from "mailparser";
import type { BounceDetails, ReceivedEmail, ReceivedEmailKind } from "../types.js";

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

const ADDRESS = /[^\s<>;,:"'()[\]]+@[^\s<>;,:"'()[\]]+\.[a-z]{2,}/gi;

const unique = (addresses: string[]) => [...new Set(addresses.map((value) => value.toLowerCase()))];

const addressesOf = (field: ParsedMail["to"]): string[] =>
  (Array.isArray(field) ? field : field ? [field] : []).flatMap((entry) =>
    entry.value.flatMap((address) => (address.address ? [address.address.toLowerCase()] : [])),
  );

/** RFC 3464 recipient blocks, from a report part or from body text a parser merged it into. */
const readDeliveryStatus = (source: string) => {
  const blocks = source
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]+/g, " ")
    .split(/\n\s*\n/);
  const recipients: { address: string; action: string }[] = [];
  let originalMessageId: string | null = null;
  for (const block of blocks) {
    const field = (name: string) => block.match(new RegExp(`^${name}:[ \\t]*(.*)$`, "im"))?.[1];
    originalMessageId ??= splitMessageIds(field("X-Original-Message-ID"))[0] ?? null;
    const recipient = field("Final-Recipient") ?? field("Original-Recipient");
    const address = recipient?.split(";").pop()?.match(ADDRESS)?.[0];
    if (address) {
      recipients.push({ address: address.toLowerCase(), action: field("Action")?.trim() ?? "" });
    }
  }
  return { recipients, originalMessageId };
};

/** Exmail attaches the original as message/rfc822; RFC 3464 reports often attach its headers. */
const readAttachedOriginal = async (parsed: ParsedMail) => {
  const part = parsed.attachments.find((attachment) =>
    /^(?:message\/(?:global|rfc822)|(?:text|message)\/rfc822-headers)$/i.test(
      attachment.contentType,
    ),
  );
  if (!part) return null;
  const original = await simpleParser(part.content);
  return {
    messageId: original.messageId ?? null,
    recipients: [...addressesOf(original.to), ...addressesOf(original.cc)],
  };
};

/** First digit of each SMTP reply code a notice cites: "550 ...", "421-...", "5.1.1", "4.4.1". */
const replyClasses = (text: string) =>
  [
    ...text.matchAll(/(?<![\w.])([245])\d{2}(?=[ -])/g),
    ...text.matchAll(/(?<![\w.])([245])\.\d{1,3}\.\d{1,3}(?![\w.])/g),
  ].map((match) => match[1]);

/** Returns null when the notice reports no failure (a delay or success notice). */
const readBounce = async (parsed: ParsedMail): Promise<BounceDetails | null> => {
  const report = readDeliveryStatus(
    [
      ...parsed.attachments
        .filter((attachment) =>
          /^message\/(?:global-)?delivery-status$/i.test(attachment.contentType),
        )
        .map((attachment) => attachment.content.toString("utf8")),
      parsed.text ?? "",
    ].join("\n\n"),
  );
  // Only a recognized non-failure Action clears a recipient; missing or unusual values stay failed.
  const failed = report.recipients
    .filter(({ action }) => !/^(?:delayed|delivered|relayed|expanded)\b/i.test(action))
    .map(({ address }) => address);
  if (report.recipients.length > 0 && failed.length === 0) return null;
  if (report.recipients.length === 0) {
    // No report (Exmail): a notice citing only temporary 4xx codes is a retry warning.
    // A notice with no code at all stays a bounce.
    const classes = replyClasses(
      `${parsed.text ?? ""}\n${(parsed.html || "").replace(/<[^>]+>/g, " ")}`,
    );
    if (classes.includes("4") && !classes.includes("5")) return null;
  }
  const original = await readAttachedOriginal(parsed);
  let recipients = failed.length
    ? failed
    : (String(parsed.headers.get("x-failed-recipients") ?? "").match(ADDRESS) ?? []);
  if (recipients.length === 0 && original) {
    // Exmail names the failed address only in its HTML notice; keep the recipients it names.
    // Never guess among several recipients: a wrong guess would block a working address.
    const named = new Set(
      unique(`${parsed.text ?? ""}\n${parsed.html || ""}`.match(ADDRESS) ?? []),
    );
    const mentioned = original.recipients.filter((address) => named.has(address));
    recipients = mentioned.length
      ? mentioned
      : original.recipients.length === 1
        ? original.recipients
        : [];
  }
  return {
    recipients: unique(recipients),
    originalMessageId: original?.messageId ?? report.originalMessageId,
  };
};

export const parseEmail = async (raw: Buffer | string): Promise<ReceivedEmail> => {
  const parsed = await simpleParser(raw);
  const header = (name: string) => String(parsed.headers.get(name) ?? "");
  const from =
    parsed.from?.value.flatMap((entry) => (entry.address ? [entry.address.toLowerCase()] : [])) ??
    [];
  const to = addressesOf(parsed.to);
  const contentType = parsed.headerLines.find((entry) => entry.key === "content-type")?.line ?? "";
  let kind: ReceivedEmailKind = "reply";
  let bounce: BounceDetails | undefined;
  if (
    from.some((address) => /^(?:mailer-daemon|postmaster)@/i.test(address)) ||
    /multipart\/report[\s\S]*report-type\s*=\s*"?delivery-status/i.test(contentType) ||
    parsed.attachments.some((attachment) => attachment.contentType === "message/delivery-status")
  ) {
    bounce = (await readBounce(parsed)) ?? undefined;
    kind = bounce ? "bounce" : "auto-reply";
  } else if (
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
    ...(bounce ? { bounce } : {}),
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename ?? null,
      contentType: attachment.contentType,
      content: attachment.content,
      size: attachment.size,
    })),
  };
};
