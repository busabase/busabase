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
  if (row?.credentialToken) {
    await revokeCloudConnectCredential(row.cloudUrl, row.credentialToken);
  }
  await clearCloudConnectCredential(db);

  return NextResponse.json({ ok: true });
}
