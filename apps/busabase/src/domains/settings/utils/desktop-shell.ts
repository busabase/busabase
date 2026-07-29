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
