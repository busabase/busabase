import { createBusabaseOpenApiClient } from "busabase-contract/api-client";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { runWithBusabaseContext } from "busabase-core/context";
import { createOpenApiMcpHandler } from "openlib/mcp";
import { readBuiltinVaultRuntimeEnv } from "~/domains/vault/logic/vault";
import { getLocalUserName } from "~/lib/local-user";

const openApiMcpHandler = createOpenApiMcpHandler({
  contract: busabaseContract,
  createClient: () =>
    createBusabaseOpenApiClient({
      baseUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:15419",
    }),
  serverInfo: { name: "Busabase MCP", version: "0.1.0" },
});

export const mcpHandler = async (request: Request) => {
  const vaultRuntimeEnv = await readBuiltinVaultRuntimeEnv();
  return runWithBusabaseContext({ vaultRuntimeEnv, localUserName: getLocalUserName() }, async () =>
    openApiMcpHandler(request),
  );
};
