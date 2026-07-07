import "server-only";

import { getDb } from "busabase-core/db";
import { getUserEnv, getUserEnvVars, updateUserEnv } from "busabase-core/domains/user-env/logic";

const LOCAL_USER_ID = null;

export async function readBuiltinUserEnvConfig() {
  return getUserEnv(await getDb(), LOCAL_USER_ID);
}

export async function readBuiltinUserEnvVars() {
  return getUserEnvVars(await getDb(), LOCAL_USER_ID);
}

export async function writeBuiltinUserEnvConfig(env: Record<string, string>) {
  return updateUserEnv(await getDb(), LOCAL_USER_ID, { env });
}
