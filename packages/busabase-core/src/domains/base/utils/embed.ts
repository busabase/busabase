import { iStringParse } from "openlib/i18n/i-string";
import type { FieldDef } from "../field-types";

export type EmbedProvider = "youtube" | "google_drive" | "generic";

export type EmbedAspectRatio = "16:9" | "4:3" | "1:1";

export interface EmbedPreview {
  provider: EmbedProvider;
  sourceUrl: string;
  embedUrl: string;
  label: string;
  hostname: string;
}

const ALLOWED_PROVIDER_NAMES = new Set<EmbedProvider>(["youtube", "google_drive", "generic"]);

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const allowedProvidersFor = (def?: FieldDef): Set<EmbedProvider> | null => {
  const configured = def?.options?.embed?.providers;
  if (!configured || configured.length === 0) {
    return null;
  }
  return new Set(
    configured.filter((provider): provider is EmbedProvider =>
      ALLOWED_PROVIDER_NAMES.has(provider as EmbedProvider),
    ),
  );
};

const providerAllowed = (provider: EmbedProvider, allowed: Set<EmbedProvider> | null) =>
  !allowed || allowed.has(provider);

const youtubeIdFromUrl = (url: URL): string | null => {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] ?? null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
    if (url.pathname.startsWith("/embed/")) {
      return url.pathname.split("/").filter(Boolean)[1] ?? null;
    }
    if (url.pathname.startsWith("/shorts/")) {
      return url.pathname.split("/").filter(Boolean)[1] ?? null;
    }
    return url.searchParams.get("v");
  }
  return null;
};

const googleDriveFileIdFromUrl = (url: URL): string | null => {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "drive.google.com" && host !== "docs.google.com") {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const fileIndex = parts.indexOf("file");
  if (fileIndex >= 0 && parts[fileIndex + 1] === "d" && parts[fileIndex + 2]) {
    return parts[fileIndex + 2];
  }
  return url.searchParams.get("id");
};

export const resolveEmbedPreview = (value: unknown, def?: FieldDef): EmbedPreview | null => {
  if (!isHttpUrl(value)) {
    return null;
  }

  const sourceUrl = value.trim();
  const url = new URL(sourceUrl);
  const allowed = allowedProvidersFor(def);
  const youtubeId = youtubeIdFromUrl(url);
  if (youtubeId && providerAllowed("youtube", allowed)) {
    return {
      provider: "youtube",
      sourceUrl,
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?rel=0&modestbranding=1`,
      label: "YouTube",
      hostname: url.hostname.replace(/^www\./, ""),
    };
  }

  const driveFileId = googleDriveFileIdFromUrl(url);
  if (driveFileId && providerAllowed("google_drive", allowed)) {
    return {
      provider: "google_drive",
      sourceUrl,
      embedUrl: `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/preview`,
      label: "Google Drive",
      hostname: url.hostname.replace(/^www\./, ""),
    };
  }

  if (!providerAllowed("generic", allowed)) {
    return null;
  }

  return {
    provider: "generic",
    sourceUrl,
    embedUrl: sourceUrl,
    label: url.hostname.replace(/^www\./, ""),
    hostname: url.hostname.replace(/^www\./, ""),
  };
};

export const validateEmbedUrl = (value: unknown, def: FieldDef): string | null =>
  resolveEmbedPreview(value, def)
    ? null
    : `${iStringParse(def.name)} must be an embeddable http(s) URL`;

export const embedAspectRatio = (def?: FieldDef): EmbedAspectRatio =>
  def?.options?.embed?.aspectRatio ?? "16:9";

export const embedHeight = (def?: FieldDef): number | undefined => def?.options?.embed?.height;
