/**
 * Storage-key safety guard, applied by every route `dev-routes.ts` builds.
 *
 * Those handlers hand the caller's key straight to the storage adapter, and the
 * local adapter does `path.join(rootDir, key)`. A key like `../../etc/passwd`
 * (which survives routing as a single percent-encoded segment) therefore
 * escapes the storage root: an arbitrary-file read on a download route, an
 * arbitrary-file WRITE on an upload route.
 *
 * This lives in openlib, and the factories run it by default, because the
 * alternative did not work: the option to drop the production gate carried a
 * doc-comment telling each caller to validate keys itself, and of the two apps
 * that took the option only one did. A security property that every caller must
 * remember to re-implement is a property the library does not have.
 *
 * Pure and isomorphic: no db, no node APIs.
 */

/** Upper bound on a storage key — real keys are ~70 chars (`sha256/xx/<hex>.png`). */
const MAX_KEY_LENGTH = 512;

/**
 * A key is safe when it is a non-empty, relative, forward-slash path that can
 * never resolve above the storage root.
 */
export const isSafeStorageKey = (key: string): boolean => {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  // NUL / control bytes, backslashes (Windows separators) and Windows drive
  // prefixes are never part of a key we mint.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control bytes is the point
  if (/[\u0000-\u001f\u007f\\]/.test(key)) return false;
  if (key.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(key)) return false;
  return key.split("/").every((segment) => segment !== ".." && segment !== ".");
};

/** 400 response used by both dev routes when the key fails the guard. */
export const invalidStorageKeyResponse = (): Response =>
  new Response("Invalid storage key", { status: 400 });
