import { fmt } from "~/i18n/messages";

/**
 * Sanitize a slug field as the user types: lowercase ASCII letters, digits and
 * single hyphens only (the server's `^[a-z0-9-]+$`). A trailing hyphen is kept
 * so `my-` can still become `my-slug` on the next keystroke. Same rule as web's
 * `toSlugInput` in busabase-core.
 */
export const toSlugInput = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/g, "");

// The sentence `nodeSlugConflict` (busabase-core logic/node-slug.ts) throws as a CONFLICT.
const SLUG_CONFLICT_PATTERN =
  /^The \S+ slug "([^"]*)" is already used in this workspace\. Choose a different slug\.$/;

/**
 * Turns the server's slug-conflict sentence into the app language, keeping the
 * slug in it. Any other message is returned unchanged.
 */
export const localizeSlugConflict = (slugTakenTemplate: string, message: string): string => {
  const match = SLUG_CONFLICT_PATTERN.exec(message);
  return match ? fmt(slugTakenTemplate, { slug: match[1] ?? "" }) : message;
};
