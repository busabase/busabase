/**
 * Whether a Doc image source is really a video — the ONE definition every host
 * uses. Pure on purpose: web's player plugin needs Milkdown and the DOM, which
 * React Native cannot load, and a second copy of this rule on the phone would
 * sooner or later disagree about what counts as a video.
 */

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".ogv", ".ogg", ".mov", ".m4v"];

/**
 * Only http(s) and protocol-relative sources are playable. Anything else —
 * notably `javascript:` and `data:` — is rejected rather than handed to a
 * `<video>` element we then attach to the DOM.
 */
function hasSafeScheme(src: string): boolean {
  const trimmed = src.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("/")) return true;
  // A bare relative path ("clip.mp4", "./clip.mp4") carries no scheme at all.
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return true;
  return /^https?:/i.test(trimmed);
}

/** Path portion only — `clip.mp4?v=2#t=10` must still read as `.mp4`. */
function pathOf(src: string): string {
  return src.trim().split("#")[0].split("?")[0].toLowerCase();
}

export function isPlayableVideoUrl(src: string | null | undefined): boolean {
  if (!src) return false;
  if (!hasSafeScheme(src)) return false;
  const path = pathOf(src);
  return VIDEO_EXTENSIONS.some((extension) => path.endsWith(extension));
}
