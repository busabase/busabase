import "server-only";

import { getDb } from "busabase-core/db";
import { getVaultRuntimeEnv } from "busabase-core/domains/vault/logic";

const LOCAL_USER_ID = null;

export async function readBuiltinVaultRuntimeEnv() {
  return getVaultRuntimeEnv(await getDb(), LOCAL_USER_ID);
}
