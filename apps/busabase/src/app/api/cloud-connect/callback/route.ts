import type { NextRequest } from "next/server";
import { getDb } from "~/db";
import {
  completeCloudConnectAuthorize,
  isDesktopCloudConnectFlow,
} from "~/domains/settings/logic/cloud-connect-oauth";
import {
  ensureCloudConnectRow,
  saveCloudConnectCredential,
} from "~/domains/settings/logic/cloud-connect-store";
import { startCloudTunnel } from "~/domains/settings/logic/cloud-tunnel-client";
import {
  buildDesktopCloudConnectReturnUrl,
  type DesktopCloudConnectReturnStatus,
} from "~/domains/settings/utils/desktop-shell";

/**
 * OAuth redirect target for the Cloud Connect flow. This route IS the
 * "loopback callback server" — OSS is already a running HTTP server reachable
 * at a loopback address (`http://localhost:<port>`, which
 * `isAllowedRedirectUri` on the Cloud side already accepts generically), so
 * there is no second ephemeral server the way `apps/busabase-cli` needs one.
 *
 * Opened as a popup by the Settings tab (see `beginCloudConnectAuthorize`'s
 * caller) — renders a tiny self-closing HTML page rather than redirecting
 * back into the SPA, so no dashboard routing/query-param plumbing is needed;
 * the still-open Settings tab in the main window picks up the new state by
 * polling `/api/cloud-connect/status`.
 */

/**
 * @param returnToDesktop when the flow came from the Busabase Desktop shell,
 *   the sign-in ran in a real OS browser tab — `window.close()` is a no-op
 *   there (browsers only let a script close a window a script opened), so the
 *   user would be left staring at a "you can close this" page with the desktop
 *   window still buried behind it. Deep link them back instead.
 */
function htmlPage(
  title: string,
  body: string,
  status = 200,
  returnToDesktop: DesktopCloudConnectReturnStatus | null = null,
): Response {
  // Only ever `ok` / `error` — a fixed pair, never user input, so this is safe
  // to interpolate into both the href and the inline script below.
  const deepLink = returnToDesktop ? buildDesktopCloudConnectReturnUrl(returnToDesktop) : null;
  const html = `<!doctype html>
<meta charset="utf-8" />
<title>${title} — Busabase</title>
<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;text-align:center;color:#1a1a1a">
  <h2>${title}</h2>
  <p>${body}</p>
${
  deepLink
    ? `  <p><a href="${deepLink}">Open Busabase Desktop</a></p>
  <script>try { window.location.href = ${JSON.stringify(deepLink)}; } catch (e) {}</script>`
    : `  <script>try { window.close(); } catch (e) {}</script>`
}
</body>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

const FAILED_TITLE = "Sign-in failed";
const CLOSE_HINT = "You can close this window and return to Busabase.";
const DESKTOP_RETURN_HINT = "Returning you to Busabase Desktop…";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const state = searchParams.get("state");
  // Read this BEFORE `completeCloudConnectAuthorize` consumes the pending flow.
  const isDesktop = isDesktopCloudConnectFlow(state);
  const hint = isDesktop ? DESKTOP_RETURN_HINT : CLOSE_HINT;
  const failureReturn = isDesktop ? "error" : null;

  const oauthError = searchParams.get("error");
  if (oauthError) {
    return htmlPage(FAILED_TITLE, `Cloud reported: ${oauthError}. ${hint}`, 400, failureReturn);
  }

  const code = searchParams.get("code");
  const issuer = searchParams.get("iss");
  if (!code || !state || !issuer) {
    return htmlPage(FAILED_TITLE, `Missing authorization code. ${hint}`, 400, failureReturn);
  }

  try {
    const credential = await completeCloudConnectAuthorize({ code, state, issuer });
    const db = await getDb();
    const row = await ensureCloudConnectRow(db);
    const ossOrigin = request.nextUrl.origin;

    await saveCloudConnectCredential(db, {
      token: credential.token,
      refreshToken: credential.refreshToken,
      expiresAt: new Date(credential.expiresAt),
      ossOrigin,
    });

    await startCloudTunnel({
      cloudUrl: row.cloudUrl,
      tunnelId: credential.tunnelId,
      token: credential.token,
      refreshToken: credential.refreshToken,
      expiresAt: new Date(credential.expiresAt),
      ossOrigin,
    });

    return htmlPage(
      "Connected",
      `Busabase Cloud is now connected. ${hint}`,
      200,
      isDesktop ? "ok" : null,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    console.error("[cloud-connect] callback failed", message);
    return htmlPage(FAILED_TITLE, `${message} ${hint}`, 500, failureReturn);
  }
}
