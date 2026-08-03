/**
 * Transport types for the OSS-local white-label branding.
 *
 * Pure zod + inferred types — no drizzle/db imports, so this file is safe to
 * import from the client (the Settings tab and the dashboard shell both do).
 * Every field is nullable: `null` means "the operator has not overridden this,
 * use the built-in default". The defaults themselves are i18n strings owned by
 * the UI, so they deliberately do NOT live here.
 */
import { z } from "zod";

/** Empty string from a cleared input means "reset to default" → `null`. */
const optionalTrimmed = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

/** Short free text (product name, tagline) — a sidebar can't show more anyway. */
const SHORT_TEXT_MAX = 200;
/**
 * A logo URL, which may be an uploaded asset URL rather than something typed by
 * hand. The upload pipeline mints content-addressed keys — e.g.
 * `/api/dev/attachment/attachments/blobs/sha256/ab/<64 hex>.png` (~110 chars)
 * — and an externally hosted logo behind a CDN with a signature can be longer
 * still. 2048 is the conventional practical URL ceiling: generous, still bounded.
 */
const URL_MAX = 2048;

export const UpdateAppBrandingDTOSchema = z.object({
  name: optionalTrimmed(SHORT_TEXT_MAX),
  description: optionalTrimmed(SHORT_TEXT_MAX),
  logoUrl: optionalTrimmed(URL_MAX),
});

export const AppBrandingVOSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  /** ISO 8601 string — never a `Date`, per the VO contract. */
  updatedAt: z.string().nullable(),
});

export type UpdateAppBrandingDTO = z.infer<typeof UpdateAppBrandingDTOSchema>;
export type AppBrandingVO = z.infer<typeof AppBrandingVOSchema>;

/** Whether the operator has actually customized anything. */
export const hasCustomBranding = (branding: AppBrandingVO | null): boolean =>
  Boolean(branding && (branding.name || branding.description || branding.logoUrl));
