import { NextResponse } from "next/server";
import { getDb } from "~/db";
import { ensureCloudConnectRow } from "~/domains/settings/logic/cloud-connect-store";
import { getCloudTunnelStatus } from "~/domains/settings/logic/cloud-tunnel-client";

/**
 * Polled by the Settings → Cloud Connect tab to reflect the relay client's
 * actual live state — never trust the UI's own optimistic guess, always ask
 * the in-process client + the persisted row.
 */
export async function GET() {
  const db = await getDb();
  const row = await ensureCloudConnectRow(db);
  const tunnel = getCloudTunnelStatus();

  return NextResponse.json({
    tunnelId: row.tunnelId,
    cloudUrl: row.cloudUrl,
    connected: Boolean(row.credentialToken),
    status: tunnel.status,
    error: tunnel.error,
  });
}
