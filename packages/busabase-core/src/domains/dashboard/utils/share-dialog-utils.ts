import type { EmbedLinkVO } from "busabase-contract/contract/embed-link-schemas";
import {
  SHARE_PASSWORD_MAX_LENGTH,
  SHARE_PASSWORD_MIN_LENGTH,
} from "busabase-contract/contract/schemas";

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

/**
 * The ancestor whose share actually makes a node public: the NEAREST one carrying
 * a live share of its own — the same "nearer wins" rule the server materializes in
 * `recomputeEffectivePublicScope`. `ancestorIds` is root-first, as `nodes.ancestors`
 * returns it; `sharedNodes` is `nodes.share.list`.
 */
export const nearestSharedAncestor = <T extends { nodeId: string }>(
  ancestorIds: readonly string[],
  sharedNodes: readonly T[],
): T | null => {
  const sharedById = new Map(sharedNodes.map((row) => [row.nodeId, row]));
  for (let index = ancestorIds.length - 1; index >= 0; index -= 1) {
    const hit = sharedById.get(ancestorIds[index] ?? "");
    if (hit) return hit;
  }
  return null;
};

const GENERATED_SHARE_PASSWORD_DIGITS = 6;
const GENERATED_SHARE_PASSWORD_RANGE = 10 ** GENERATED_SHARE_PASSWORD_DIGITS;
// The largest multiple of the range that fits in a uint32. Draws at or above it
// are thrown away and redrawn, because folding them in with `%` would make the
// low codes (000000–967295) slightly likelier than the rest — modulo bias. A
// redraw happens for ~0.02% of draws, so the loop is effectively one pass.
const GENERATED_SHARE_PASSWORD_LIMIT =
  Math.floor(2 ** 32 / GENERATED_SHARE_PASSWORD_RANGE) * GENERATED_SHARE_PASSWORD_RANGE;

/**
 * A fresh share password: six digits, uniformly random, from the platform's
 * CSPRNG (`crypto.getRandomValues`, in browsers and Node alike). Digits rather
 * than words because the code is meant to be read out or retyped from a chat
 * message; the unlock route's failed-attempt limit is what makes six enough.
 */
export const generateSharePassword = (
  getRandomValues: (array: Uint32Array<ArrayBuffer>) => unknown = (array) =>
    globalThis.crypto.getRandomValues(array),
): string => {
  const draw = new Uint32Array(1);
  let value: number;
  do {
    getRandomValues(draw);
    value = draw[0] ?? GENERATED_SHARE_PASSWORD_LIMIT;
  } while (value >= GENERATED_SHARE_PASSWORD_LIMIT);
  return String(value % GENERATED_SHARE_PASSWORD_RANGE).padStart(
    GENERATED_SHARE_PASSWORD_DIGITS,
    "0",
  );
};

/** The same length bounds `nodes.share.set` enforces, for inline validation. */
export const isSharePasswordLengthValid = (password: string): boolean =>
  password.length >= SHARE_PASSWORD_MIN_LENGTH && password.length <= SHARE_PASSWORD_MAX_LENGTH;
