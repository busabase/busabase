/**
 * Playbooks published through MCP's own primitives (agent-playbook-discovery.md §7a
 * follow-up 2): custom node prompts over `prompts/*`, Skill nodes over `resources/*`.
 *
 * Every call goes through openlib's real MCP HTTP handler (JSON-RPC over a Request),
 * inside a busabase-core context, against a real PGLite space — so the naming, the
 * rendering, and the ACL are the ones a client actually gets.
 */
import { createRouterClient } from "@orpc/server";
import type { CustomAgentPrompts } from "busabase-contract/contract/node-agent-prompt-schemas";
import { createOpenApiMcpHandler } from "openlib/mcp";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import {
  BUSABASE_MCP_SKILL_NODE_URI_TEMPLATE,
  buildPlaybookPromptNames,
  createBusabaseMcpPlaybookProviders,
  type PlaybookPromptItem,
  skillNodeUri,
} from "../src/mcp-playbooks";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const asManager = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true }, fn);
const asMember = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId: "bob", isSpaceManager: false }, fn);

const VISIT_PROMPTS: CustomAgentPrompts = [
  {
    key: "log-visit",
    intent: "change",
    label: { en: "Log a customer visit", "zh-CN": "记录客户拜访" },
    body: {
      en: "Add one record to {target} for today's customer visit.",
      "zh-CN": "在 {target} 里为今天的客户拜访新增一条记录。",
    },
  },
  {
    key: "visit-summary",
    intent: "read-only",
    label: "Summarize this month's visits",
    body: "Read {target} and summarize this month's visits.",
  },
];

const STATIC_MANUAL = {
  uri: "busabase://skill",
  name: "busabase-skill",
  description: "Static manual",
  read: () => "manual",
};

const STATIC_PROMPT = { name: "busabase_setup", description: "Setup", get: () => "setup" };

const createHandler = (providers = createBusabaseMcpPlaybookProviders()) =>
  createOpenApiMcpHandler({
    contract: {},
    createClient: () => ({}),
    prompts: [STATIC_PROMPT],
    resources: [STATIC_MANUAL],
    documentProviders: providers,
  });

type RpcResult = {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

const rpc = async (
  handler: ReturnType<typeof createHandler>,
  method: string,
  params?: Record<string, unknown>,
): Promise<RpcResult> => {
  const response = await handler(
    new Request("http://busabase.test/api/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as RpcResult;
};

type ListedPrompt = { name: string; title?: string; description?: string; arguments?: unknown[] };
type ListedResource = { uri: string; name: string; description?: string; mimeType?: string };

const seedFixture = async (scenario: string) => {
  await seedScenario(scenario);
  const raw: RawClient = createRouterClient(busabaseRouter);
  const cr = await asManager(() =>
    raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "seed mcp playbooks fixture",
      operations: [
        { kind: "create", nodeType: "folder", slug: "sales", name: "Sales", ref: "sales" },
        {
          kind: "create",
          nodeType: "base",
          slug: "visits",
          name: "Visits",
          parentNodeRef: "sales",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
        // Same slug, different node type: slugs are only unique per type.
        { kind: "create", nodeType: "doc", slug: "visits", name: "Visit notes" },
        {
          kind: "create",
          nodeType: "skill",
          slug: "weekly-report",
          name: "Weekly Report",
          description: "Compile the weekly sales report every Friday",
          parentNodeRef: "sales",
        },
        {
          kind: "create",
          nodeType: "base",
          slug: "payroll",
          name: "Payroll",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
        {
          kind: "create",
          nodeType: "skill",
          slug: "payroll-runbook",
          name: "Payroll Runbook",
          description: "How payroll is run",
        },
      ],
    }),
  );
  expect(cr.status).toBe("merged");
  const tree = await asManager(() => raw.nodes.list());
  const flat = (nodes: typeof tree): typeof tree =>
    nodes.flatMap((node) => [node, ...flat(node.children)]);
  const all = flat(tree);
  const id = (slug: string, type: string) => {
    const node = all.find((candidate) => candidate.slug === slug && candidate.type === type);
    if (!node) throw new Error(`fixture node ${type}:${slug} was not created`);
    return node.id;
  };
  const ids = {
    visits: id("visits", "base"),
    visitNotes: id("visits", "doc"),
    weeklyReport: id("weekly-report", "skill"),
    payroll: id("payroll", "base"),
    payrollRunbook: id("payroll-runbook", "skill"),
  };
  await asManager(async () => {
    await raw.nodes.updateAgentPrompts({ nodeId: ids.visits, agentPrompts: VISIT_PROMPTS });
    await raw.nodes.updateAgentPrompts({
      nodeId: ids.visitNotes,
      agentPrompts: [{ key: "log-visit", label: "Tidy the visit notes", body: "Tidy {target}." }],
    });
    await raw.nodes.updateAgentPrompts({
      nodeId: ids.payroll,
      agentPrompts: [{ key: "run-payroll", label: "Run payroll", body: "Pay {target}." }],
    });
    await raw.nodes.updateVisibility({ nodeId: ids.payroll, visibility: "private" });
    await raw.nodes.updateVisibility({ nodeId: ids.payrollRunbook, visibility: "private" });
    // A skill node's default visibility is not open to every member; make this one so.
    await raw.nodes.updateVisibility({ nodeId: ids.weeklyReport, visibility: "workspace" });
  });
  return { raw, ids };
};

describe("MCP playbook prompts and resources", () => {
  it("lists, renders, and reads playbooks through the real MCP handler, within the caller's ACL", async () => {
    const { raw, ids } = await seedFixture("mcp-playbooks");
    const handler = createHandler();

    // ── prompts/list ──────────────────────────────────────────────────────────
    const managerPrompts = (await asManager(() => rpc(handler, "prompts/list"))).result
      ?.prompts as ListedPrompt[];
    const memberPrompts = (await asMember(() => rpc(handler, "prompts/list"))).result
      ?.prompts as ListedPrompt[];

    // Static prompt first and untouched.
    expect(managerPrompts[0]).toEqual({ name: "busabase_setup", description: "Setup" });
    const names = memberPrompts.map((prompt) => prompt.name);
    expect(names).toEqual([
      "busabase_setup",
      // listPlaybooks order: top level first, then Sales/…, by label within a folder.
      // The two `visits` slugs collide, so both carry their node id.
      `playbook__visits__log-visit__${ids.visitNotes}`,
      `playbook__visits__log-visit__${ids.visits}`,
      "playbook__visits__visit-summary",
    ]);
    // The private Base's prompt: a manager sees it, a member never does.
    expect(managerPrompts.map((prompt) => prompt.name)).toContain("playbook__payroll__run-payroll");
    expect(names).not.toContain("playbook__payroll__run-payroll");

    expect(memberPrompts.find((p) => p.name.endsWith(ids.visits))).toEqual({
      name: `playbook__visits__log-visit__${ids.visits}`,
      title: "Log a customer visit",
      description: "Log a customer visit — custom prompt on Visits (Sales)",
      arguments: [expect.objectContaining({ name: "locale", required: false })],
    });
    expect(memberPrompts.find((p) => p.name.endsWith(ids.visitNotes))?.description).toBe(
      "Tidy the visit notes — custom prompt on Visit notes (top level)",
    );

    // ── prompts/get: byte-identical to playbooks.get ──────────────────────────
    const name = `playbook__visits__log-visit__${ids.visits}`;
    const got = (await asMember(() => rpc(handler, "prompts/get", { name }))).result as {
      description: string;
      messages: Array<{ role: string; content: { type: string; text: string } }>;
    };
    const expected = await asMember(() =>
      raw.playbooks.get({ kind: "prompt", nodeId: ids.visits, key: "log-visit" }),
    );
    expect(got.description).toBe("Log a customer visit — custom prompt on Visits (Sales)");
    expect(got.messages).toEqual([
      { role: "user", content: { type: "text", text: expected.content } },
    ]);
    // Without a locale the footer defers to the user's language, exactly as playbooks.get does.
    expect(expected.content).toContain("Reply in the user's language.");

    const gotZh = (
      await asMember(() => rpc(handler, "prompts/get", { name, arguments: { locale: "zh-CN" } }))
    ).result as { messages: Array<{ content: { text: string } }> };
    const expectedZh = await asMember(() =>
      raw.playbooks.get({ kind: "prompt", nodeId: ids.visits, key: "log-visit", locale: "zh-CN" }),
    );
    expect(gotZh.messages[0]?.content.text).toBe(expectedZh.content);
    expect(gotZh.messages[0]?.content.text).toContain("客户拜访");

    // A member cannot open the private prompt by name either — plain "not found".
    const hidden = await asMember(() =>
      rpc(handler, "prompts/get", { name: "playbook__payroll__run-payroll" }),
    );
    expect(hidden.error?.message).toContain("MCP prompt not found");
    // The static prompt is still served.
    expect(
      (
        (await asMember(() => rpc(handler, "prompts/get", { name: "busabase_setup" }))).result
          ?.messages as Array<{ content: { text: string } }>
      )[0]?.content.text,
    ).toBe("setup");

    // ── resources ─────────────────────────────────────────────────────────────
    const templates = (await asMember(() => rpc(handler, "resources/templates/list"))).result;
    expect(templates?.resourceTemplates).toEqual([
      expect.objectContaining({
        uriTemplate: BUSABASE_MCP_SKILL_NODE_URI_TEMPLATE,
        mimeType: "text/markdown",
      }),
    ]);

    const memberResources = (await asMember(() => rpc(handler, "resources/list"))).result
      ?.resources as ListedResource[];
    expect(memberResources).toEqual([
      {
        uri: "busabase://skill",
        name: "busabase-skill",
        description: "Static manual",
        mimeType: "text/markdown",
      },
      {
        uri: `busabase://skill/${ids.weeklyReport}`,
        name: "Weekly Report",
        description: "Compile the weekly sales report every Friday",
        mimeType: "text/markdown",
      },
    ]);
    const managerResources = (await asManager(() => rpc(handler, "resources/list"))).result
      ?.resources as ListedResource[];
    expect(managerResources.map((resource) => resource.uri)).toContain(
      skillNodeUri(ids.payrollRunbook),
    );

    const read = (
      await asMember(() => rpc(handler, "resources/read", { uri: skillNodeUri(ids.weeklyReport) }))
    ).result as { contents: Array<{ uri: string; mimeType: string; text: string }> };
    const skill = await asMember(() =>
      raw.playbooks.get({ kind: "skill", nodeId: ids.weeklyReport }),
    );
    expect(skill.content).toContain("Weekly Report");
    expect(read.contents).toEqual([
      { uri: skillNodeUri(ids.weeklyReport), mimeType: "text/markdown", text: skill.content },
    ]);

    // The private skill is unreadable for a member, and a non-skill node is not a skill.
    for (const uri of [skillNodeUri(ids.payrollRunbook), skillNodeUri(ids.visits)]) {
      const refused = await asMember(() => rpc(handler, "resources/read", { uri }));
      expect(refused.error?.message).toContain("MCP resource not found");
    }
    // The static manual is still served.
    expect(
      (
        (await asMember(() => rpc(handler, "resources/read", { uri: "busabase://skill" }))).result
          ?.contents as Array<{ text: string }>
      )[0]?.text,
    ).toBe("manual");
  });

  it("caps the listings without changing names, and lists nothing when the host has no space", async () => {
    const { ids } = await seedFixture("mcp-playbooks-cap");
    const capped = createHandler(createBusabaseMcpPlaybookProviders({ limit: 1 }));
    const prompts = (await asManager(() => rpc(capped, "prompts/list"))).result
      ?.prompts as ListedPrompt[];
    // Static + the first playbook prompt only.
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      "busabase_setup",
      "playbook__payroll__run-payroll",
    ]);
    const resources = (await asManager(() => rpc(capped, "resources/list"))).result
      ?.resources as ListedResource[];
    expect(resources).toHaveLength(2);
    // A prompt past the cap still opens under the same name it has uncapped.
    const beyond = await asManager(() =>
      rpc(capped, "prompts/get", { name: "playbook__visits__visit-summary" }),
    );
    expect(beyond.error).toBeUndefined();

    // A host that cannot name one space (Cloud, several spaces, no header).
    const noSpace = createHandler(
      createBusabaseMcpPlaybookProviders({ withSpace: async () => null }),
    );
    expect(
      ((await asManager(() => rpc(noSpace, "prompts/list"))).result?.prompts as ListedPrompt[]).map(
        (prompt) => prompt.name,
      ),
    ).toEqual(["busabase_setup"]);
    expect(
      (
        (await asManager(() => rpc(noSpace, "resources/list"))).result
          ?.resources as ListedResource[]
      ).map((resource) => resource.uri),
    ).toEqual(["busabase://skill"]);
    expect(
      (
        await asManager(() =>
          rpc(noSpace, "resources/read", { uri: skillNodeUri(ids.weeklyReport) }),
        )
      ).error?.message,
    ).toContain("MCP resource not found");
    expect(
      (
        await asManager(() =>
          rpc(noSpace, "prompts/get", { name: "playbook__visits__visit-summary" }),
        )
      ).error?.message,
    ).toContain("MCP prompt not found");
  });
});

describe("buildPlaybookPromptNames", () => {
  const prompt = (nodeId: string, nodeSlug: string, key: string): PlaybookPromptItem => ({
    nodeId,
    nodeName: nodeSlug,
    nodeSlug,
    path: [],
    key,
    label: key,
    intent: "change",
  });

  it("keeps names to MCP-safe characters, never nests the separator, and stays unique", () => {
    const names = buildPlaybookPromptNames([
      prompt("n1", "客户", "记录"),
      prompt("n2", "Sales Pipeline", "weekly__report"),
      prompt("n3", "dup", "a b"),
      prompt("n3", "dup", "a-b"),
      prompt("n4", "x".repeat(100), "k"),
    ]);
    expect(names[0]).toBe("playbook__n1__prompt");
    expect(names[1]).toBe("playbook__Sales-Pipeline__weekly_report");
    expect(names[2]).toBe("playbook__dup__a-b__n3");
    expect(names[3]).toBe("playbook__dup__a-b__n3_2");
    expect(names[4]).toBe(`playbook__${"x".repeat(48)}__k`);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(new Set(names).size).toBe(names.length);
  });
});
