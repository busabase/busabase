import { createBusabaseOpenApiClient } from "busabase-contract/api-client";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { AGENT_EXCLUDED_MCP_TOOLS, TASK_SUPERSEDED_MCP_TOOLS } from "busabase-contract/tasks";
import { runWithBusabaseContext } from "busabase-core/context";
import { createOpenApiMcpHandler } from "openlib/mcp";
import { readBuiltinVaultRuntimeEnv } from "~/domains/vault/logic/vault";
import { getLocalUserName } from "~/lib/local-user";
import { busabaseLocalMcpTaskTools } from "./task-tools";

const withheldFromMcp = new Set<string>([
  ...TASK_SUPERSEDED_MCP_TOOLS,
  ...AGENT_EXCLUDED_MCP_TOOLS,
]);

const openApiMcpHandler = createOpenApiMcpHandler({
  // Task-level tools shared with busabase-cli and busabase-cloud.
  additionalTools: busabaseLocalMcpTaskTools(),
  contract: busabaseContract,
  createClient: () =>
    createBusabaseOpenApiClient({
      baseUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:15419",
    }),
  // Endpoint tools a task now covers. Without this the catalog would carry both
  // spellings, and the endpoint one is the worse of the two (creating a Skill
  // through it silently omits the default scaffold).
  exclude: (tool) => withheldFromMcp.has(tool.name),
  serverInfo: { name: "Busabase MCP", version: "0.1.0" },
});

export const mcpHandler = async (request: Request) => {
  const vaultRuntimeEnv = await readBuiltinVaultRuntimeEnv();
  return runWithBusabaseContext({ vaultRuntimeEnv, localUserName: getLocalUserName() }, async () =>
    openApiMcpHandler(request),
  );
};
