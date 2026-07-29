import { createBusabaseOpenApiClient } from "busabase-contract/api-client";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { AGENT_EXCLUDED_MCP_TOOLS, TASK_SUPERSEDED_MCP_TOOLS } from "busabase-contract/tasks";
import { runWithBusabaseContext } from "busabase-core/context";
import {
  BUSABASE_MCP_AIRAPP_URI,
  buildBusabaseMcpAirAppSkill,
  busabaseMcpGuideTool,
} from "busabase-core/mcp-skill";
import { createOpenApiMcpHandler } from "openlib/mcp";
import { readBuiltinVaultRuntimeEnv } from "~/domains/vault/logic/vault";
import { getLocalUserName } from "~/lib/local-user";
import { busabaseLocalMcpTaskTools } from "./task-tools";

const withheldFromMcp = new Set<string>([
  ...TASK_SUPERSEDED_MCP_TOOLS,
  ...AGENT_EXCLUDED_MCP_TOOLS,
]);

const openApiMcpHandler = createOpenApiMcpHandler({
  // Task-level tools shared with busabase-cli and busabase-cloud, plus the guide tool — the
  // only surface that reaches a client which surfaces neither `resources/*` nor `prompts/*`.
  //
  // Only the deployment-neutral topic is published here: `workspace`, `setup` and `create-app`
  // all instruct the agent to pass `targetSpaceId`, which only Cloud's handler accepts. Same
  // reason the `busabase://skill` resource is not mirrored below.
  additionalTools: [busabaseMcpGuideTool(["airapp"]), ...busabaseLocalMcpTaskTools()],
  contract: busabaseContract,
  createClient: () =>
    createBusabaseOpenApiClient({
      baseUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:15419",
    }),
  // Endpoint tools a task now covers. Without this the catalog would carry both
  // spellings, and the endpoint one is the worse of the two (creating a Skill
  // through it silently omits the default scaffold).
  exclude: (tool) => withheldFromMcp.has(tool.name),
  // The AirApp runtime contract is the one document that is identical on both deployments: it
  // teaches `npm run dev`, the no-bundler rule, and `/api/v1` on the app's own origin, none of
  // which differ self-hosted. Without it an MCP client building an app here scaffolds a Vite
  // project that cannot boot, exactly as it does against Cloud.
  //
  // Cloud's `busabase://skill` resource and its two prompts are deliberately NOT mirrored: they
  // instruct the agent to pass `targetSpaceId`, which only Cloud's handler accepts (it adds
  // `BUSABASE_MCP_TARGET_SPACE_SCHEMA` via `additionalToolsInputSchema`). Publishing them here
  // would teach an argument this server rejects. A self-hosted variant is its own change.
  resources: [
    {
      uri: BUSABASE_MCP_AIRAPP_URI,
      name: "busabase-airapp",
      title: "Busabase AirApp runtime contract",
      description:
        "How to build an AirApp that actually runs: the `npm run dev` contract, why bundler dev servers and native binaries cannot boot, a complete working example, reading workspace data over /api/v1, and what each failing run log means.",
      mimeType: "text/markdown",
      read: () => buildBusabaseMcpAirAppSkill(),
    },
  ],
  serverInfo: { name: "Busabase MCP", version: "0.1.0" },
});

export const mcpHandler = async (request: Request) => {
  const vaultRuntimeEnv = await readBuiltinVaultRuntimeEnv();
  return runWithBusabaseContext({ vaultRuntimeEnv, localUserName: getLocalUserName() }, async () =>
    openApiMcpHandler(request),
  );
};
