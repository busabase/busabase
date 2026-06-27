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

// Best-effort actor label. There is no user directory yet (actor ids are opaque
// strings like "local-admin"/"agent"), so we prettify known sentinels and slugs.
// When a real users source lands, resolve display name + avatar here.
const KNOWN_ACTOR_LABELS: Record<string, string> = {
  "local-admin": "Local Admin",
  "local-producer": "Local Producer",
  agent: "Agent",
  producer: "Producer",
};

const formatActorLabel = (actorId: unknown): string => {
  const id = typeof actorId === "string" ? actorId.trim() : "";
  if (!id) return "—";
  return (
    KNOWN_ACTOR_LABELS[id] ?? id.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
};

export {
  fieldValueToString,
  formatNumberField,
  shortIdentifier,
  formatListTime,
  formatDetailTime,
  formatAttachmentSize,
  KNOWN_ACTOR_LABELS,
  formatActorLabel,
};
