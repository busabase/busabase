import type { NextRequest } from "next/server";
import { getDb } from "~/db";
import { completeCloudConnectAuthorize } from "~/domains/settings/logic/cloud-connect-oauth";
import {
  ensureCloudConnectRow,
  saveCloudConnectCredential,
} from "~/domains/settings/logic/cloud-connect-store";
import { startCloudTunnel } from "~/domains/settings/logic/cloud-tunnel-client";

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

function htmlPage(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<meta charset="utf-8" />
<title>${title} — Busabase</title>
<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;text-align:center;color:#1a1a1a">
  <h2>${title}</h2>
  <p>${body}</p>
  <script>try { window.close(); } catch (e) {}</script>
</body>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

const FAILED_TITLE = "Sign-in failed";
const CLOSE_HINT = "You can close this window and return to Busabase.";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const oauthError = searchParams.get("error");
  if (oauthError) {
    return htmlPage(FAILED_TITLE, `Cloud reported: ${oauthError}. ${CLOSE_HINT}`, 400);
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const issuer = searchParams.get("iss");
  if (!code || !state || !issuer) {
    return htmlPage(FAILED_TITLE, `Missing authorization code. ${CLOSE_HINT}`, 400);
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

    return htmlPage("Connected", `Busabase Cloud is now connected. ${CLOSE_HINT}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    console.error("[cloud-connect] callback failed", message);
    return htmlPage(FAILED_TITLE, `${message} ${CLOSE_HINT}`, 500);
  }
}
