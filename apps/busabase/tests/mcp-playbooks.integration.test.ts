import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The self-hosted `/api/mcp` publishes this workspace's playbooks through MCP's own
 * primitives (agent-playbook-discovery.md §7a follow-up 2). Driven end to end: the
 * fixture is written over the real `/api/v1` route, and every MCP call goes through the
 * real `/api/mcp` route handler — the same wiring a client reaches.
 */
describe("self-hosted MCP playbook prompts and resources", () => {
  let dataDir = "";
  let storageDir = "";
  let v1: typeof import("../src/app/api/v1/[[...rest]]/route");
  let mcp: typeof import("../src/app/api/mcp/route");

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-mcp-playbooks-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-mcp-playbooks-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    v1 = await import("../src/app/api/v1/[[...rest]]/route");
    mcp = await import("../src/app/api/mcp/route");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const api = async (method: string, route: string, body?: unknown) => {
    const handler = v1[method as "GET" | "POST" | "PUT"];
    const response = await handler(
      new Request(`http://localhost/api/v1${route}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    return payload;
  };

  const rpc = async (
    method: string,
    params?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => {
    const response = await mcp.POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
      }),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      result?: Record<string, unknown>;
      error?: { message: string };
    };
  };

  it("lists custom prompts and skills next to the static documents, and serves them", async () => {
    await api("POST", "/nodes/change-requests", {
      autoMerge: true,
      message: "seed mcp playbooks",
      operations: [
        { kind: "create", nodeType: "folder", slug: "crm", name: "CRM", ref: "crm" },
        {
          kind: "create",
          nodeType: "base",
          slug: "visits",
          name: "Visits",
          parentNodeRef: "crm",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
        {
          kind: "create",
          nodeType: "skill",
          slug: "weekly-report",
          name: "Weekly Report",
          description: "Compile the weekly report",
        },
      ],
    });
    const nodes = (await api("GET", "/nodes")) as Array<{
      id: string;
      slug: string;
      type: string;
      children: unknown[];
    }>;
    type TreeNode = { id: string; slug: string; type: string; children: TreeNode[] };
    const flat = (list: TreeNode[]): TreeNode[] =>
      list.flatMap((node) => [node, ...flat(node.children)]);
    const all = flat(nodes as TreeNode[]);
    const visitsId = all.find((node) => node.slug === "visits")?.id as string;
    const skillId = all.find((node) => node.slug === "weekly-report")?.id as string;
    expect(visitsId && skillId).toBeTruthy();
    await api("PUT", `/nodes/${visitsId}/agent-prompts`, {
      agentPrompts: [
        {
          key: "log-visit",
          label: { en: "Log a visit", "zh-CN": "记录拜访" },
          body: { en: "Add a visit to {target}.", "zh-CN": "在 {target} 新增一次拜访。" },
        },
      ],
    });

    const init = await rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.result?.capabilities).toEqual(
      expect.objectContaining({ prompts: {}, resources: {}, tools: {} }),
    );

    const prompts = (await rpc("prompts/list")).result?.prompts;
    expect(prompts).toEqual([
      {
        name: "playbook__visits__log-visit",
        title: "Log a visit",
        description: "Log a visit — custom prompt on Visits (CRM)",
        arguments: [expect.objectContaining({ name: "locale" })],
      },
    ]);

    const got = (
      await rpc("prompts/get", {
        name: "playbook__visits__log-visit",
        arguments: { locale: "zh-CN" },
      })
    ).result as { messages: Array<{ role: string; content: { text: string } }> };
    const expected = await api("GET", `/playbooks/prompt/${visitsId}?key=log-visit&locale=zh-CN`);
    expect(got.messages).toEqual([
      { role: "user", content: { type: "text", text: expected.content } },
    ]);

    const resources = (await rpc("resources/list")).result?.resources as Array<{
      uri: string;
      name: string;
    }>;
    expect(resources.map((resource) => resource.uri)).toEqual([
      "busabase://skill",
      "busabase://airapp",
      `busabase://skill/${skillId}`,
    ]);
    expect(resources[2]).toMatchObject({
      name: "Weekly Report",
      description: "Compile the weekly report",
      mimeType: "text/markdown",
    });
    expect((resources[0] as { description?: string }).description).toContain("at most 200");

    const templates = (await rpc("resources/templates/list")).result?.resourceTemplates;
    expect(templates).toEqual([
      expect.objectContaining({ uriTemplate: "busabase://skill/{nodeId}" }),
    ]);

    const read = (await rpc("resources/read", { uri: `busabase://skill/${skillId}` })).result as {
      contents: Array<{ text: string; mimeType: string }>;
    };
    const skill = await api("GET", `/playbooks/skill/${skillId}`);
    expect(read.contents[0]?.text).toBe(skill.content);
    expect(read.contents[0]?.mimeType).toBe("text/markdown");

    // The tool catalog is untouched by all of this.
    const tools = (await rpc("tools/list")).result?.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name)).toContain("playbooks_search");
    expect(tools.map((tool) => tool.name).some((name) => name.startsWith("playbook__"))).toBe(
      false,
    );
  });
});
