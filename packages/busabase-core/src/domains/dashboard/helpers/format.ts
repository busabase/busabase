import type { UserRefVO } from "busabase-contract/types";

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

const formatOpaqueUserId = (actorId: unknown): string => {
  const id = typeof actorId === "string" ? actorId.trim() : "";
  if (!id) return "—";
  return KNOWN_ACTOR_LABELS[id] ?? prettifyHumanIdentifier(id) ?? `User ${shortIdentifier(id)}`;
};

const formatUserRefLabel = (user: UserRefVO | null | undefined, fallbackId?: string | null) => {
  if (user?.name?.trim()) {
    return user.name.trim();
  }
  if (user?.email?.trim()) {
    return user.email.trim();
  }
  if (fallbackId && KNOWN_ACTOR_LABELS[fallbackId]) {
    return KNOWN_ACTOR_LABELS[fallbackId];
  }
  return fallbackId ? `Unknown user ${shortIdentifier(fallbackId)}` : "Unknown user";
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
