/**
 * Bridge for handing a URL to the OS default browser when this app is running
 * inside the Busabase Desktop shell (`apps/busabase-desktop`), which embeds the
 * local sidecar in an iframe.
 *
 * Why it exists: the Tauri webview does **not** implement `window.open()`. wry
 * only wires WebKitGTK's `create` signal / WKWebView's `createWebViewWith` /
 * WebView2's `NewWindowRequested` when the host registers an `on_new_window`
 * handler, and the desktop shell declares its window in `tauri.conf.json`
 * without one — so `window.open()` returns `null` unconditionally there. The
 * Cloud Connect sign-in popup therefore looked "blocked" on every single click.
 *
 * The shell listens for {@link DESKTOP_OPEN_EXTERNAL_REQUEST} and forwards the
 * URL to `@tauri-apps/plugin-opener`, then answers with
 * {@link DESKTOP_OPEN_EXTERNAL_RESULT}. The OAuth redirect target is the
 * sidecar's own loopback callback, so finishing sign-in in a real browser lands
 * back on `http://localhost:<port>/api/cloud-connect/callback` exactly like the
 * popup would have.
 */

export const DESKTOP_OPEN_EXTERNAL_REQUEST = "busabase-desktop:open-external";
export const DESKTOP_OPEN_EXTERNAL_RESULT = "busabase-desktop:open-external:result";

/**
 * Deep link the OAuth callback page uses to hand the user back to the desktop
 * app once sign-in finished in the OS browser.
 *
 * Why a *second* hop instead of making this the OAuth `redirect_uri`: Cloud
 * only whitelists loopback redirect URIs for the `tunnel` client kind, so the
 * authorization
 * code must keep landing on `http://localhost:<port>/api/cloud-connect/callback`.
 * That page then navigates the browser to this custom scheme, which the OS
 * hands to `apps/busabase-desktop` — no OAuth secret ever travels over it, only
 * a success/failure marker. The desktop app raises its window and tells the
 * embedded Settings tab to refresh immediately.
 *
 * The path is deliberately NOT `busabase://oauth/callback` — that one belongs
 * to `apps/busabase-mobile`'s own OAuth flow and is whitelisted by Cloud as a
 * real redirect URI. Keeping them distinct means neither can be mistaken for
 * the other.
 *
 * Kept in sync with `apps/busabase-desktop/src/app/page.tsx` and
 * `apps/busabase-desktop/src-tauri/tauri.conf.json`.
 */
export const DESKTOP_DEEP_LINK_SCHEME = "busabase";
export const DESKTOP_CLOUD_CONNECT_RETURN_PATH = "desktop/cloud-connect";

export type DesktopCloudConnectReturnStatus = "ok" | "error";

/** `busabase://desktop/cloud-connect?status=ok` */
export function buildDesktopCloudConnectReturnUrl(status: DesktopCloudConnectReturnStatus): string {
  return `${DESKTOP_DEEP_LINK_SCHEME}://${DESKTOP_CLOUD_CONNECT_RETURN_PATH}?status=${status}`;
}

/**
 * Posted by the desktop shell into the embedded sidecar iframe when the deep
 * link above arrives, so the Settings tab reflects the result on the next tick
 * instead of waiting out its 2s status poll.
 */
export const DESKTOP_CLOUD_CONNECT_RETURNED = "busabase-desktop:cloud-connect-returned";

export interface DesktopCloudConnectReturnedMessage {
  type: typeof DESKTOP_CLOUD_CONNECT_RETURNED;
  status: DesktopCloudConnectReturnStatus;
}

/**
 * Should this `message` event be treated as the desktop shell reporting a
 * finished Cloud Connect sign-in?
 *
 * Only the frame that embedded us may say so. The origin itself cannot be
 * pinned — see {@link REQUEST_TARGET_ORIGIN} for why the shell's origin is not
 * knowable from here — so this gates on the source frame, the same way
 * {@link openExternalViaDesktopShell} gates the reply it waits for.
 */
export function isDesktopCloudConnectReturn(
  event: Pick<MessageEvent, "data" | "source">,
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): DesktopCloudConnectReturnStatus | null {
  const parent = win?.parent;
  if (!win || !parent || parent === win) return null;
  if (event.source !== parent) return null;
  const data = event.data as Partial<DesktopCloudConnectReturnedMessage> | null | undefined;
  if (!data || data.type !== DESKTOP_CLOUD_CONNECT_RETURNED) return null;
  return data.status === "ok" || data.status === "error" ? data.status : null;
}

/**
 * The request goes to `*` because the shell's own origin is not knowable from
 * here: Tauri serves the host page from `tauri://localhost` (Linux/macOS),
 * `http(s)://tauri.localhost` (Windows) or the dev-server origin under
 * `tauri dev`. Pinning that list would silently break the flow the day any of
 * them changes. It is safe to widen: the payload is a public authorize URL, not
 * a credential — the PKCE verifier never leaves the sidecar's server memory and
 * the authorization code is delivered to the sidecar's own loopback callback.
 * The *reply* is still checked (it must come from our direct parent and carry
 * the matching request id), and the shell in turn only accepts requests from
 * the sidecar origin it framed.
 */
const REQUEST_TARGET_ORIGIN = "*";

/** The shell answers within a frame or two; this only bounds the "no shell" case. */
const ACK_TIMEOUT_MS = 2000;

export interface DesktopOpenExternalRequest {
  type: typeof DESKTOP_OPEN_EXTERNAL_REQUEST;
  requestId: string;
  url: string;
}

export interface DesktopOpenExternalResult {
  type: typeof DESKTOP_OPEN_EXTERNAL_RESULT;
  requestId: string;
  ok: boolean;
}

let requestCounter = 0;

/**
 * - `opened` — the shell confirmed it handed the URL to the OS browser.
 * - `failed` — the shell tried and could not (so "allow popups" is the wrong advice).
 * - `unavailable` — we are not inside the shell: no parent frame, or nothing answered.
 */
export type DesktopOpenExternalOutcome = "opened" | "failed" | "unavailable";

/** Ask the desktop shell to open `url` in the OS default browser. */
export async function openExternalViaDesktopShell(
  url: string,
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): Promise<DesktopOpenExternalOutcome> {
  const parent = win?.parent;
  if (!win || !parent || parent === win) return "unavailable";

  requestCounter += 1;
  const requestId = `cloud-connect-${requestCounter}`;

  return new Promise<DesktopOpenExternalOutcome>((resolve) => {
    let settled = false;

    const finish = (outcome: DesktopOpenExternalOutcome) => {
      if (settled) return;
      settled = true;
      win.clearTimeout(timer);
      win.removeEventListener("message", onMessage);
      resolve(outcome);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== parent) return;
      const data = event.data as Partial<DesktopOpenExternalResult> | null | undefined;
      if (!data || data.type !== DESKTOP_OPEN_EXTERNAL_RESULT) return;
      if (data.requestId !== requestId) return;
      finish(data.ok === true ? "opened" : "failed");
    };

    const timer = win.setTimeout(() => finish("unavailable"), ACK_TIMEOUT_MS);
    win.addEventListener("message", onMessage);

    const message: DesktopOpenExternalRequest = {
      type: DESKTOP_OPEN_EXTERNAL_REQUEST,
      requestId,
      url,
    };
    parent.postMessage(message, REQUEST_TARGET_ORIGIN);
  });
}
