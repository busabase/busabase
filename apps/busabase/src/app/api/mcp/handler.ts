import { BUSABASE_RELAY_PERMISSION_LEVEL_HEADER } from "busabase-contract/access-control/api-key-level";
import { createBusabaseOpenApiClient } from "busabase-contract/api-client";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  BUSABASE_PLAYBOOK_HEADER,
  parsePlaybookRef,
} from "busabase-contract/contract/playbook-schemas";
import { AGENT_EXCLUDED_MCP_TOOLS, TASK_SUPERSEDED_MCP_TOOLS } from "busabase-contract/tasks";
import {
  getContextEmbedOrigin,
  getContextPermissionLevel,
  getContextPermissionLevelIsCeiling,
  runWithLocalContext,
} from "busabase-core/context";
import {
  BUSABASE_MCP_SKILL_RESOURCE_DESCRIPTION,
  createBusabaseMcpPlaybookProviders,
} from "busabase-core/mcp-playbooks";
import {
  BUSABASE_MCP_AIRAPP_URI,
  BUSABASE_MCP_APPS_TOPIC,
  BUSABASE_MCP_PRIORITY_TOOL_NAMES,
  BUSABASE_MCP_SKILL_URI,
  BUSABASE_SELF_HOSTED_MCP_INSTRUCTIONS,
  buildBusabaseMcpAirAppSkill,
  buildBusabaseMcpSkill,
  busabaseMcpGuideTool,
  GUIDE_SUPERSEDED_MCP_TOOLS,
  getBusabaseMcpToolAnnotations,
} from "busabase-core/mcp-skill";
import {
  createOpenApiMcpHandler,
  type DiscoveredOpenApiTool,
  type McpToolCallContext,
} from "openlib/mcp";
import { z } from "zod";
import { readBuiltinVaultRuntimeEnv } from "~/domains/vault/logic/vault";
import { getLocalUserName } from "~/lib/local-user";
import { resolveRelayPermissionContext } from "~/lib/relay-permission";
import { busabaseLocalMcpTaskTools } from "./task-tools";

const withheldFromMcp = new Set<string>([
  ...TASK_SUPERSEDED_MCP_TOOLS,
  ...AGENT_EXCLUDED_MCP_TOOLS,
  ...GUIDE_SUPERSEDED_MCP_TOOLS,
]);

export const resolveLocalMcpBaseUrl = (): string =>
  getContextEmbedOrigin() ?? "http://localhost:15419";

/**
 * Playbook attribution (spec §11b H1): an agent names the playbook it is
 * following and the change request records it. Same argument and header as
 * Cloud's `public-tools.ts`; this server just has no `targetSpaceId` beside it.
 */
export const LOCAL_MCP_PLAYBOOK_SCHEMA = z.object({
  playbook: z
    .string()
    .trim()
    .refine((value) => parsePlaybookRef(value) !== null, {
      message:
        "Expected `skill:<nodeId>` or `prompt:<nodeId>:<key>`, copied from playbooks_search. Omit it if you are not following a playbook.",
    })
    .describe(
      "Optional. The playbook you are following, as `kind:nodeId[:key]` from playbooks_search (e.g. `prompt:nod_123:log-visit`). Recorded on the change request so the person can see which playbook produced it.",
    )
    .optional(),
});

/**
 * Contract tools get `playbook` only when they can open a change request — i.e.
 * not read-only by the same method-derived rule that labels them for clients.
 * Task tools share ONE extra schema in openlib, so every task tool carries it
 * (harmless on a read: the header only matters on a request that opens a CR).
 */
export const getLocalMcpAdditionalInputSchema = (tool: DiscoveredOpenApiTool) =>
  getBusabaseMcpToolAnnotations(tool).readOnlyHint ? undefined : LOCAL_MCP_PLAYBOOK_SCHEMA;

export const getLocalMcpPlaybookHeaders = (
  context: McpToolCallContext | undefined,
): Record<string, string> => {
  const args = context?.args;
  const value =
    args && typeof args === "object" ? (args as Record<string, unknown>).playbook : undefined;
  const playbook = typeof value === "string" ? value.trim() : "";
  return playbook && parsePlaybookRef(playbook) ? { [BUSABASE_PLAYBOOK_HEADER]: playbook } : {};
};

const openApiMcpHandler = createOpenApiMcpHandler({
  // Task-level tools shared with busabase-cli and busabase-cloud, plus the guide tool — the
  // only surface that reaches a client which surfaces neither `resources/*` nor `prompts/*`.
  //
  // Both reference guides, built with space targeting OFF — this server has one local workspace
  // and no `targetSpaceId` argument, so Cloud's wording would teach a parameter it rejects.
  // The two walkthroughs stay Cloud-only: they are guided onboarding written around choosing a
  // space, which is not a step that exists here.
  additionalTools: [
    // `apps` is dynamic and workspace-local: it lists the app manuals installed
    // HERE, which is the whole point of a template. It must be published
    // wherever the instructions advertise it, or an agent is told to call a
    // topic the tool refuses.
    busabaseMcpGuideTool(["workspace", "airapp", BUSABASE_MCP_APPS_TOPIC], {
      spaceTargeting: false,
    }),
    ...busabaseLocalMcpTaskTools(),
  ],
  additionalInputSchema: getLocalMcpAdditionalInputSchema,
  additionalToolsInputSchema: LOCAL_MCP_PLAYBOOK_SCHEMA,
  // Same method-derived annotations as Cloud, so read-only POSTs (`playbooks_search`, `grep`)
  // are labelled read-only here too and a client can call them without a write prompt.
  annotations: getBusabaseMcpToolAnnotations,
  contract: busabaseContract,
  // Tool calls reach the workspace over loopback HTTP to this same server's
  // `/api/v1`, which builds its own request context — so a ceiling carried on
  // the *incoming* MCP request does not propagate on its own. `createClient` is
  // invoked per tool call inside `mcpHandler`'s context scope, so it re-reads
  // the ceiling there and re-sends it on the outgoing call, where
  // `resolveRelayPermissionContext` picks it up and `node-acl.ts` enforces it.
  // Absent a ceiling (any ordinary local caller) this sends no header and the
  // permissive local default stands.
  createClient: (_extra, context) => {
    const ceiling = getContextPermissionLevelIsCeiling() ? getContextPermissionLevel() : undefined;
    return createBusabaseOpenApiClient({
      // The CLI can start this prebuilt Next bundle on any loopback port.
      // NEXT_PUBLIC_* values are inlined at build time, so using that env here
      // sends MCP tools back to the build machine's origin instead of the
      // server handling this request.
      baseUrl: resolveLocalMcpBaseUrl(),
      headers: {
        ...(ceiling ? { [BUSABASE_RELAY_PERMISSION_LEVEL_HEADER]: ceiling } : {}),
        ...getLocalMcpPlaybookHeaders(context),
      },
    });
  },
  // This workspace's playbooks through MCP's own primitives — each custom node prompt a
  // `playbook__…` prompt, each Skill node a `busabase://skill/{nodeId}` resource — for hosts
  // that show prompts/resources to the human but pay little attention to `instructions`.
  // Read in-process: `mcpHandler` below has already bound this request's local context
  // (including any relay ceiling), so the ACL is the one `/api/v1/playbooks/*` applies.
  documentProviders: createBusabaseMcpPlaybookProviders(),
  description: (tool, defaultDescription) =>
    tool.keyPath[0] === "embedLinks"
      ? `${defaultDescription}\n\nCreate an embed link only when the user explicitly asks to share or preview that target. The returned URL is a bearer capability: reveal or open it only when the user requests that action.`
      : defaultDescription,
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
  // Same first three tools as Cloud: the ones the instructions ask for before any work.
  priorityToolNames: BUSABASE_MCP_PRIORITY_TOOL_NAMES,
  // The two reference documents, for clients that support `resources/*`. The two prompts stay
  // Cloud-only — they are guided onboarding built around picking a space.
  resources: [
    {
      uri: BUSABASE_MCP_SKILL_URI,
      name: "busabase-skill",
      title: "Busabase agent skill",
      description: BUSABASE_MCP_SKILL_RESOURCE_DESCRIPTION,
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
  return runWithLocalContext(
    {
      vaultRuntimeEnv,
      localUserName: getLocalUserName(),
      embedOrigin: new URL(request.url).origin,
      // Honour a caller-supplied credential ceiling on this MCP session — the
      // same header the tunnel forwards for a Cloud API key, and what a
      // Busabase-spawned agent now sends to cap itself at proposing rather
      // than writing. It can only lower access, never raise it.
      aclOverride: resolveRelayPermissionContext(request.headers),
    },
    async () => openApiMcpHandler(request),
  );
};
