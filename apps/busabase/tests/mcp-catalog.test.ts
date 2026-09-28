import { busabaseContract } from "busabase-contract/contract/busabase";
import { AGENT_EXCLUDED_MCP_TOOLS, TASK_SUPERSEDED_MCP_TOOLS } from "busabase-contract/tasks";
import { runWithLocalContext } from "busabase-core/context";
import { getBusabaseMcpToolAnnotations } from "busabase-core/mcp-skill";
import { createMcpToolsFromOpenApiContract } from "openlib/mcp";
import { describe, expect, it } from "vitest";
import {
  getLocalMcpAdditionalInputSchema,
  getLocalMcpPlaybookHeaders,
  LOCAL_MCP_PLAYBOOK_SCHEMA,
  resolveLocalMcpBaseUrl,
} from "../src/app/api/mcp/handler";

/**
 * What the self-hosted server actually publishes over `/api/mcp`.
 *
 * Mirrors the exclusion wiring in `src/app/api/mcp/handler.ts`. The point of the
 * test is the negative assertions: a tool slipping back into this catalog is not
 * something typecheck or lint can catch, and two of the cases below were live.
 */
const withheld = new Set<string>([...TASK_SUPERSEDED_MCP_TOOLS, ...AGENT_EXCLUDED_MCP_TOOLS]);

const publishedTools = () =>
  createMcpToolsFromOpenApiContract({
    contract: busabaseContract,
    client: {},
    exclude: (tool) => withheld.has(tool.name),
  });

const publishedToolNames = () => publishedTools().map((tool) => tool.name);

describe("self-hosted MCP catalog", () => {
  it("routes internal tool calls back to the server handling the MCP request", async () => {
    await expect(
      runWithLocalContext(
        {
          vaultRuntimeEnv: {},
          localUserName: "Local Admin",
          embedOrigin: "http://127.0.0.1:43127",
        },
        async () => resolveLocalMcpBaseUrl(),
      ),
    ).resolves.toBe("http://127.0.0.1:43127");
  });

  it("never publishes the Vault", () => {
    // `vault.get` returns each item's DECRYPTED value — `rowToVO` in
    // busabase-core decodes it, and the per-item `access.reveal` policy is
    // passed through rather than enforced. Publishing these would hand an agent
    // every credential in the workspace, and `clear` would let it wipe them.
    // Busabase Cloud has always withheld the namespace; this server did not.
    const names = publishedToolNames();
    expect(names).not.toContain("vault_get");
    expect(names).not.toContain("vault_update");
    expect(names).not.toContain("vault_clear");
  });

  it("never publishes Event Iterators as callable tools", () => {
    // These omit `.route(...)`, but oRPC leaves `route: {}` behind, which is
    // truthy — so tool discovery used to register them as REST tools that could
    // only fail when called.
    const names = publishedToolNames();
    expect(names).not.toContain("live_subscribe");
    expect(names).not.toContain("airapps_run_local_node");
  });

  it("never publishes one person's mention inbox", () => {
    // These carry no user id — the actor comes from context — so on an agent's
    // credential they operate on the person who issued it. Reading that inbox
    // gives an agent nothing (its own mentions are `targetType = "agent"`, which
    // this query excludes), and `mark_mentions_read` would let it clear the
    // unread state that is the only thing telling a human someone is waiting on
    // them. Both stay available over `/api/v1` with the owner's own key.
    const names = publishedToolNames();
    expect(names).not.toContain("comments_list_mentions");
    expect(names).not.toContain("comments_mark_mentions_read");
  });

  it("still publishes the everyday surface", () => {
    // The counterweight: the exclusions above must not have taken anything real
    // with them.
    expect(publishedToolNames()).toEqual(
      expect.arrayContaining([
        "auth_verify",
        "search",
        "grep",
        // agent-playbook-discovery.md: the first call on every instruction.
        "playbooks_search",
        "playbooks_get",
        "nodes_list",
        "bases_list",
        "bases_get",
        "records_get",
        "change_requests_get",
        "nodes_read_lines",
        "embed_links_create",
        "embed_links_list",
        "embed_links_revoke",
      ]),
    );
    expect(publishedToolNames()).not.toContain("assets_grep");
    expect(publishedToolNames()).not.toContain("records_get_by_field");
  });

  it("labels read-only POST tools read-only, the same way Cloud does", () => {
    // `handler.ts` passes the shared `getBusabaseMcpToolAnnotations`. Without it the
    // playbook search — the first call on every instruction — carried no hint at all,
    // so a client that auto-approves reads still prompted for it.
    const annotationFor = (name: string) => {
      const tool = publishedTools().find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`${name} is not published`);
      return getBusabaseMcpToolAnnotations(tool);
    };
    expect(annotationFor("playbooks_search")).toMatchObject({ readOnlyHint: true });
    expect(annotationFor("grep")).toMatchObject({ readOnlyHint: true });
    expect(annotationFor("playbooks_get")).toMatchObject({ readOnlyHint: true });
    expect(annotationFor("nodes_update_agent_prompts")).toMatchObject({ readOnlyHint: false });
  });

  it("offers `playbook` on write tools only and maps it to the playbook header", () => {
    const toolNamed = (name: string) => {
      const tool = publishedTools().find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`${name} is not published`);
      return tool;
    };
    expect(getLocalMcpAdditionalInputSchema(toolNamed("nodes_update_agent_prompts"))).toBe(
      LOCAL_MCP_PLAYBOOK_SCHEMA,
    );
    for (const name of ["playbooks_search", "grep", "auth_verify"]) {
      expect(getLocalMcpAdditionalInputSchema(toolNamed(name)), name).toBeUndefined();
    }

    // A malformed ref is rejected (a prompt needs its key); a good one is trimmed.
    expect(LOCAL_MCP_PLAYBOOK_SCHEMA.safeParse({ playbook: "prompt:nod_1" }).success).toBe(false);
    expect(LOCAL_MCP_PLAYBOOK_SCHEMA.safeParse({ playbook: " skill:nod_1 " }).data).toEqual({
      playbook: "skill:nod_1",
    });

    const tool = toolNamed("nodes_update_agent_prompts");
    expect(
      getLocalMcpPlaybookHeaders({ tool, args: { playbook: " prompt:nod_123:log-visit " } }),
    ).toEqual({ "x-busabase-playbook": "prompt:nod_123:log-visit" });
    expect(getLocalMcpPlaybookHeaders({ tool, args: {} })).toEqual({});
    expect(getLocalMcpPlaybookHeaders({ tool, args: { playbook: "skill:nod_1:key" } })).toEqual({});
    expect(getLocalMcpPlaybookHeaders(undefined)).toEqual({});
  });
});
