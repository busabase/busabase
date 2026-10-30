/**
 * Sanitize a slug field as the user types: lowercase ASCII letters, digits and
 * single hyphens only — the server's `^[a-z0-9-]+$`. A trailing hyphen is kept
 * so `my-` can still become `my-slug` on the next keystroke.
 */
export const toSlugInput = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/g, "");
