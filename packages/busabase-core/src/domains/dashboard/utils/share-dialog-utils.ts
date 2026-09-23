import type { EmbedLinkVO } from "busabase-contract/contract/embed-link-schemas";

export type ShareExpiryPreset = "never" | "1-day" | "7-days" | "30-days" | "custom";

const PRESET_DAYS: Partial<Record<ShareExpiryPreset, number>> = {
  "1-day": 1,
  "7-days": 7,
  "30-days": 30,
};

export const expiryIsoForPreset = (
  preset: ShareExpiryPreset,
  customValue: string,
  now = new Date(),
): string | null => {
  if (preset === "never") return null;
  if (preset === "custom") {
    if (!customValue) return null;
    const customDate = new Date(customValue);
    return Number.isNaN(customDate.getTime()) ? null : customDate.toISOString();
  }

  const days = PRESET_DAYS[preset];
  if (!days) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
};

export const toDatetimeLocalValue = (value: string | null | undefined): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const publicPreviewUrl = (publicUrl: string): string => {
  const previewUrl = new URL(publicUrl);
  previewUrl.searchParams.set("share-preview", "1");
  return previewUrl.toString();
};

export const partitionEmbedLinks = (links: EmbedLinkVO[]) => ({
  active: links.filter((link) => link.active && !link.revokedAt),
  history: links.filter((link) => !link.active || Boolean(link.revokedAt)),
});
