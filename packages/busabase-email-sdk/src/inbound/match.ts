import type { ReceivedEmail, ReplyMatch, ReplyWatch } from "../types.js";

/** Exmail may add a hexadecimal token to an outgoing RFC Message-ID. */
export const normalizeMessageId = (id: string): string => {
  return id.trim().replace(/^<[a-f\d]{8,}\+/i, "<");
};

export const matchReply = (email: ReceivedEmail, watch: ReplyWatch): ReplyMatch | null => {
  const sent = new Set((watch.messageIds ?? []).map(normalizeMessageId));
  const ses = new Set(watch.sesMessageIds ?? []);
  // A bounce notice often names the original only inside its report or attached message.
  const original = email.bounce?.originalMessageId;
  const thread =
    [...email.inReplyTo, ...email.references, ...(original ? [original] : [])].find((id) => {
      const normalized = normalizeMessageId(id);
      if (sent.has(normalized)) return true;
      const parts = normalized.match(/^<([^<>@]+)@([^<>]+)>$/);
      return Boolean(
        parts &&
          /^(?:[a-z\d-]+\.)*amazonses\.com$/i.test(parts[2] ?? "") &&
          ses.has(parts[1] ?? ""),
      );
    }) ?? null;
  const senders = new Set((watch.senders ?? []).map((address) => address.trim().toLowerCase()));
  // For a bounce the watched peer is the failed recipient, not the mailer daemon.
  const peers = [...email.from, ...(email.bounce?.recipients ?? [])];
  const bySender = peers.some((address) => {
    const normalized = address.trim().toLowerCase();
    return senders.has(normalized) || senders.has(`@${normalized.split("@")[1] ?? ""}`);
  });
  if (!thread && !bySender) return null;
  return {
    matchedBy: bySender ? (thread ? "sender+thread" : "sender") : "thread",
    repliesToMessageId: thread,
  };
};
