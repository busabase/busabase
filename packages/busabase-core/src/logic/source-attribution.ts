import type { BusabaseSourceChannel, SourceAttributionVO } from "busabase-contract/types";

const SOURCE_CHANNELS = new Set<BusabaseSourceChannel>([
  "web_ui",
  "browser",
  "openapi",
  "sdk",
  "cli",
  "mcp",
  "skill",
  "webhook",
  "automation",
  "import",
]);

const FLAT_PROVENANCE_KEYS = [
  "apiKey",
  "key",
  "credential",
  "keyProfile",
  "owner",
  "ownerUser",
  "user",
  "apiKeyName",
  "credentialName",
  "keyName",
  "profileName",
  "ownerName",
  "ownerUserName",
  "userName",
  "channel",
  "sourceChannel",
  "via",
] as const;

const STRONG_FLAT_PROVENANCE_KEYS = [
  "apiKey",
  "key",
  "credential",
  "keyProfile",
  "apiKeyName",
  "credentialName",
  "keyName",
  "profileName",
  "ownerName",
  "ownerUserName",
  "userName",
  "sourceChannel",
  "via",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstRecord = (value: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys) {
    if (isRecord(value[key])) return value[key];
  }
  return undefined;
};

const firstString = (value: Record<string, unknown> | undefined, keys: readonly string[]) => {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
};

const normalizeChannel = (value: string | null): BusabaseSourceChannel | null => {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  if (normalized === "api" || normalized === "open_api" || normalized === "rest") {
    return "openapi";
  }
  return SOURCE_CHANNELS.has(normalized as BusabaseSourceChannel)
    ? (normalized as BusabaseSourceChannel)
    : null;
};

const hasStrongFlatProvenance = (sourceMeta: Record<string, unknown>) => {
  return STRONG_FLAT_PROVENANCE_KEYS.some((key) => sourceMeta[key] !== undefined);
};

const provenanceRecord = (sourceMeta: Record<string, unknown>) => {
  if (isRecord(sourceMeta.provenance)) return sourceMeta.provenance;
  return hasStrongFlatProvenance(sourceMeta) ? sourceMeta : null;
};

export const extractSourceAttribution = (
  sourceMeta: Record<string, unknown>,
): SourceAttributionVO | null => {
  const provenance = provenanceRecord(sourceMeta);
  if (!provenance) return null;

  const owner = firstRecord(provenance, ["owner", "ownerUser", "user"]);
  const credential = firstRecord(provenance, ["apiKey", "key", "credential", "keyProfile"]);
  const ownerName =
    firstString(owner, ["name", "displayName", "label"]) ??
    firstString(provenance, ["ownerName", "ownerUserName", "userName"]);
  const displayName =
    firstString(credential, ["name", "displayName", "label"]) ??
    firstString(provenance, ["apiKeyName", "credentialName", "keyName", "profileName"]);
  const rawChannel =
    firstString(provenance, ["channel", "sourceChannel", "via"]) ??
    firstString(credential, ["channel"]);

  return {
    displayName,
    ownerName,
    channel: normalizeChannel(rawChannel) ?? "openapi",
  };
};

export const sanitizePublicSourceMeta = (
  sourceMeta: Record<string, unknown>,
): Record<string, unknown> => {
  const sanitized = { ...sourceMeta };
  if (isRecord(sourceMeta.provenance)) {
    delete sanitized.provenance;
    return sanitized;
  }
  if (hasStrongFlatProvenance(sourceMeta)) {
    for (const key of FLAT_PROVENANCE_KEYS) delete sanitized[key];
  }
  return sanitized;
};

export const toPublicSourceMetadata = (sourceMeta: Record<string, unknown>) => ({
  sourceAttribution: extractSourceAttribution(sourceMeta),
  sourceMeta: sanitizePublicSourceMeta(sourceMeta),
});

export const toPublicAuditMetadata = (metadata: Record<string, unknown>) => {
  const sourceMeta = isRecord(metadata.sourceMeta) ? metadata.sourceMeta : null;
  const sanitizedMetadata = sanitizePublicSourceMeta(metadata);
  const attributionSource = sourceMeta ?? metadata;
  const sourceAttribution = extractSourceAttribution(attributionSource);
  if (!sourceMeta) return { metadata: sanitizedMetadata, sourceAttribution };
  return {
    metadata: { ...sanitizedMetadata, sourceMeta: sanitizePublicSourceMeta(sourceMeta) },
    sourceAttribution,
  };
};
