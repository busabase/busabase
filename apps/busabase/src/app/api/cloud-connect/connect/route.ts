import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getDb } from "~/db";
import { beginCloudConnectAuthorize } from "~/domains/settings/logic/cloud-connect-oauth";
import { ensureCloudConnectRow, setCloudUrl } from "~/domains/settings/logic/cloud-connect-store";

function normalizeCloudUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Kick off the Connect flow: persist the chosen Cloud URL, ensure the stable
 * local tunnelId exists, build the PKCE authorize URL (spec §5a), and hand it
 * back for the client to `window.open()` — a popup, not a full-page redirect,
 * so this Settings tab stays mounted and can poll `/status` for the result.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { cloudUrl?: unknown };
  const db = await getDb();
  const row = await ensureCloudConnectRow(db);

  const requestedCloudUrl = typeof body.cloudUrl === "string" ? body.cloudUrl.trim() : "";
  const cloudUrl = normalizeCloudUrl(requestedCloudUrl || row.cloudUrl);
  if (!cloudUrl) {
    return NextResponse.json({ error: "A valid Cloud URL is required." }, { status: 400 });
  }
  if (cloudUrl !== row.cloudUrl) {
    await setCloudUrl(db, cloudUrl);
  }

  const redirectUri = new URL("/api/cloud-connect/callback", request.nextUrl.origin).toString();
  const { authorizeUrl } = beginCloudConnectAuthorize({
    cloudUrl,
    tunnelId: row.tunnelId,
    redirectUri,
  });

  return NextResponse.json({ authorizeUrl });
}
