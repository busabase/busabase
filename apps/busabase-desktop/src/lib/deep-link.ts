/**
 * `busabase://` deep links handled by the desktop shell.
 *
 * Why they exist: Cloud Connect sign-in cannot run inside the Tauri webview
 * (it implements no `window.open()`), so the embedded sidecar hands the
 * authorize URL to the OS default browser. That browser tab is a dead end —
 * it cannot close itself (only script-opened windows can) and it has no way to
 * reach back into this window. So the sidecar's OAuth callback page navigates
 * to a `busabase://` URL, the OS routes it to this app, and we raise the window
 * and tell the embedded Settings tab the result.
 *
 * Kept in sync with `apps/busabase/src/domains/settings/utils/desktop-shell.ts`
 * (which builds these URLs) and `src-tauri/tauri.conf.json` (which registers
 * the scheme with the OS).
 */

const CLOUD_CONNECT_RETURN_HOST = "desktop";
const CLOUD_CONNECT_RETURN_PATH = "/cloud-connect";

/** Message posted into the sidecar iframe once a return deep link arrives. */
export const CLOUD_CONNECT_RETURNED = "busabase-desktop:cloud-connect-returned";

export type CloudConnectReturnStatus = "ok" | "error";

/**
 * `busabase://desktop/cloud-connect?status=ok` → `"ok"`.
 *
 * Anything else — a different scheme, a different path, a missing or unknown
 * `status`, an unparseable string — returns `null` and is ignored. In
 * particular `busabase://oauth/callback` (which belongs to
 * `apps/busabase-mobile`) must never be mistaken for a Cloud Connect return.
 */
export function parseCloudConnectReturn(rawUrl: string): CloudConnectReturnStatus | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "busabase:") return null;
  if (url.hostname !== CLOUD_CONNECT_RETURN_HOST) return null;
  // Normalise a trailing slash away so `…/cloud-connect/` also matches.
  if (url.pathname.replace(/\/+$/, "") !== CLOUD_CONNECT_RETURN_PATH) return null;
  const status = url.searchParams.get("status");
  return status === "ok" || status === "error" ? status : null;
}
