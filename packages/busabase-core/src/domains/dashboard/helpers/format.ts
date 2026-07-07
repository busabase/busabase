import type { UserRefVO } from "busabase-contract/types";
import { type CoreI18nMessages, fmt } from "../../../i18n";

const fieldValueToString = (value: unknown) => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
};

// Number-field display formatter. Currency-formatted only when the field opts in
// via `options.number.format === "currency"`; plain number fields are unchanged.
const formatNumberField = (
  value: unknown,
  options?: { format?: "plain" | "currency"; currency?: string; locale?: string },
) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    return fieldValueToString(value);
  }
  if (options?.format === "currency") {
    return new Intl.NumberFormat(options.locale, {
      style: "currency",
      currency: options.currency ?? "USD",
    }).format(num);
  }
  return fieldValueToString(value);
};

const shortIdentifier = (value: string | null | undefined) => value?.slice(0, 10) ?? "none";

const formatListTime = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

const formatDetailTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const formatAttachmentSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const KNOWN_ACTOR_LABELS: Record<string, string> = {
  "local-admin": "Local Admin",
  "local-editor": "Local Editor",
  "local-producer": "Local Producer",
  "local-user": "Local User",
  "local-viewer": "Local Viewer",
  agent: "Agent",
  producer: "Producer",
};

const getLocalizedActorLabels = (messages?: CoreI18nMessages): Record<string, string> => ({
  "local-admin": messages?.actor.localAdmin ?? KNOWN_ACTOR_LABELS["local-admin"],
  "local-editor": messages?.actor.localEditor ?? KNOWN_ACTOR_LABELS["local-editor"],
  "local-producer": messages?.actor.localProducer ?? KNOWN_ACTOR_LABELS["local-producer"],
  "local-user": messages?.actor.localUser ?? KNOWN_ACTOR_LABELS["local-user"],
  "local-viewer": messages?.actor.localViewer ?? KNOWN_ACTOR_LABELS["local-viewer"],
  agent: messages?.actor.agent ?? KNOWN_ACTOR_LABELS.agent,
  producer: messages?.actor.producer ?? KNOWN_ACTOR_LABELS.producer,
});

const titleCaseToken = (value: string) =>
  value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}` : "";

const prettifyHumanIdentifier = (value: string) => {
  if (!/[._-]/.test(value) || !/[a-z]/i.test(value)) {
    return null;
  }
  const parts = value
    .split(/[._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part.length > 32)) {
    return null;
  }
  return parts.map(titleCaseToken).join(" ");
};

const formatOpaqueUserId = (actorId: unknown, messages?: CoreI18nMessages): string => {
  const id = typeof actorId === "string" ? actorId.trim() : "";
  if (!id) return "—";
  return (
    getLocalizedActorLabels(messages)[id] ??
    prettifyHumanIdentifier(id) ??
    (messages
      ? fmt(messages.identity.userFallback, { id: shortIdentifier(id) })
      : `User ${shortIdentifier(id)}`)
  );
};

const formatUserRefLabel = (
  user: UserRefVO | null | undefined,
  fallbackId?: string | null,
  messages?: CoreI18nMessages,
) => {
  if (user?.name?.trim()) {
    return user.name.trim();
  }
  if (user?.email?.trim()) {
    return user.email.trim();
  }
  if (fallbackId && getLocalizedActorLabels(messages)[fallbackId]) {
    return getLocalizedActorLabels(messages)[fallbackId];
  }
  if (fallbackId) {
    return messages
      ? fmt(messages.identity.unknownUserFallback, { id: shortIdentifier(fallbackId) })
      : `Unknown user ${shortIdentifier(fallbackId)}`;
  }
  return messages?.identity.unknownUser ?? "Unknown user";
};

const formatUserRefSubtitle = (user: UserRefVO | null | undefined) => {
  if (user?.email?.trim() && user.email !== user.name) {
    return user.email;
  }
  if (user?.role?.trim()) {
    return user.role;
  }
  return null;
};

export {
  fieldValueToString,
  formatNumberField,
  shortIdentifier,
  formatListTime,
  formatDetailTime,
  formatAttachmentSize,
  KNOWN_ACTOR_LABELS,
  formatOpaqueUserId,
  formatUserRefLabel,
  formatUserRefSubtitle,
};
