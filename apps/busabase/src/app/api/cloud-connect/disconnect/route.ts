import { NextResponse } from "next/server";
import { getDb } from "~/db";
import { revokeCloudConnectCredential } from "~/domains/settings/logic/cloud-connect-oauth";
import {
  clearCloudConnectCredential,
  getCloudConnectRow,
} from "~/domains/settings/logic/cloud-connect-store";
import { stopCloudTunnel } from "~/domains/settings/logic/cloud-tunnel-client";

export async function POST() {
  const db = await getDb();
  const row = await getCloudConnectRow(db);

  await stopCloudTunnel();
  const tokenToRevoke = row?.credentialRefreshToken ?? row?.credentialToken;
  if (row && tokenToRevoke) {
    await revokeCloudConnectCredential(row.cloudUrl, tokenToRevoke);
  }
  await clearCloudConnectCredential(db);

  return NextResponse.json({ ok: true });
}
