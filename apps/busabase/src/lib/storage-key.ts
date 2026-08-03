/**
 * Storage-key safety guard for the app's `/api/dev/upload` and
 * `/api/dev/attachment/[...key]` routes.
 *
 * Those routes are un-gated in production for this app (self-hosted
 * `busabase server` runs a production build, and every locally stored
 * attachment — including the sidebar logo — is served through them). The
 * openlib handlers hand the key straight to the storage adapter, whose local
 * implementation does `path.join(rootDir, key)`. Without a guard, a key like
 * `../../etc/passwd` (which survives as a single percent-encoded path segment)
 * would escape the storage root — an arbitrary-file read on the download route
 * and an arbitrary-file write on the upload route.
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
