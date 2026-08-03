import { createBusabaseOpenApiClient } from "busabase-contract/api-client";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { AGENT_EXCLUDED_MCP_TOOLS, TASK_SUPERSEDED_MCP_TOOLS } from "busabase-contract/tasks";
import { runWithBusabaseContext } from "busabase-core/context";
import {
  BUSABASE_MCP_AIRAPP_URI,
  BUSABASE_MCP_SKILL_URI,
  BUSABASE_SELF_HOSTED_MCP_INSTRUCTIONS,
  buildBusabaseMcpAirAppSkill,
  buildBusabaseMcpSkill,
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
  // Both reference guides, built with space targeting OFF — this server has one local workspace
  // and no `targetSpaceId` argument, so Cloud's wording would teach a parameter it rejects.
  // The two walkthroughs stay Cloud-only: they are guided onboarding written around choosing a
  // space, which is not a step that exists here.
  additionalTools: [
    busabaseMcpGuideTool(["workspace", "airapp"], { spaceTargeting: false }),
    ...busabaseLocalMcpTaskTools(),
  ],
  contract: busabaseContract,
  createClient: () =>
    createBusabaseOpenApiClient({
      baseUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:15419",
    }),
  // Endpoint tools a task now covers. Without this the catalog would carry both
  // spellings, and the endpoint one is the worse of the two (creating a Skill
  // through it silently omits the default scaffold).
  exclude: (tool) => withheldFromMcp.has(tool.name),
  // This server returned NO instructions at all until now, so its agents received none of the
  // approval-first rules — nothing but the API's own permissions stopped one from merging its
  // own proposal or filing a change request titled `cmtmr1th34`. Cloud's document could not be
  // reused verbatim (it teaches `targetSpaceId`, which this server does not accept), so it is
  // the same source built with space targeting off.
  instructions: BUSABASE_SELF_HOSTED_MCP_INSTRUCTIONS,
  // The two reference documents, for clients that support `resources/*`. The two prompts stay
  // Cloud-only — they are guided onboarding built around picking a space.
  resources: [
    {
      uri: BUSABASE_MCP_SKILL_URI,
      name: "busabase-skill",
      title: "Busabase agent skill",
      description:
        "The full approval-first workflow: everyday tools, proposing structure, field types, starter blueprints, the revision loop, error handling, and the untrusted-content rules.",
      mimeType: "text/markdown",
      read: () => buildBusabaseMcpSkill({ spaceTargeting: false }),
    },
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
