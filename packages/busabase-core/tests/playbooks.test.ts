/**
 * `playbooks.search` / `playbooks.get` (agent-playbook-discovery.md §6, test
 * plan §13 I1–I9) against a real PGLite database, plus one pass through the
 * real OpenAPI handler so the `/api/v1` boundary (body decode, path params,
 * query string) is exercised and not just the in-process client.
 *
 * Also covers item C: a merged change request that edits a skill's SKILL.md
 * frontmatter moves the node's `description` with it (I6).
 */
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import type { CustomAgentPrompts } from "busabase-contract/contract/node-agent-prompt-schemas";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseNodes } from "../src/db/schema";
import { buildNodeAgentPrompts } from "../src/domains/dashboard/helpers/node-agent-prompts";
import { coreMessagesByLocale } from "../src/i18n/catalog";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const API = "http://busabase.test/api/v1";

const asManager = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true }, fn);

const asMember = <T>(actorId: string, fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId, isSpaceManager: false }, fn);

const VISIT_PROMPTS: CustomAgentPrompts = [
  {
    key: "log-visit",
    intent: "change",
    label: { en: "Log a customer visit", "zh-CN": "记录客户拜访" },
    body: {
      en: "Add one record to {target} for today's customer visit: who, what was discussed, next step.",
      "zh-CN": "在 {target} 里为今天的客户拜访新增一条记录：拜访对象、讨论内容、下一步。",
    },
  },
  {
    key: "visit-summary",
    intent: "read-only",
    label: "Summarize this month's visits",
    body: "Read {target} and summarize this month's visits by account.",
  },
];

/** Create nodes in one merged change request and return `slug -> nodeId`. */
const createNodes = async (
  raw: RawClient,
  operations: Parameters<RawClient["nodes"]["createChangeRequest"]>[0]["operations"],
): Promise<Map<string, string>> => {
  const cr = await raw.nodes.createChangeRequest({
    autoMerge: true,
    message: "seed playbooks fixture",
    operations,
  });
  expect(cr.status).toBe("merged");
  const tree = await raw.nodes.list();
  const flat = (nodes: typeof tree): typeof tree =>
    nodes.flatMap((node) => [node, ...flat(node.children)]);
  return new Map(flat(tree).map((node) => [node.slug, node.id]));
};

const idOf = (ids: Map<string, string>, slug: string): string => {
  const id = ids.get(slug);
  if (!id) throw new Error(`fixture node ${slug} was not created`);
  return id;
};

describe("playbooks.search / playbooks.get", () => {
  it("I1+I2+I3+I8+I9: ranks a matching prompt first over HTTP, renders it like Ask Agent, matches every locale, finds hand-written skills, and excludes built-ins", async () => {
    await seedScenario("playbooks-core");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const ids = await asManager(() =>
      createNodes(raw, [
        { kind: "create", nodeType: "folder", slug: "sales", name: "Sales", ref: "sales" },
        {
          kind: "create",
          nodeType: "base",
          slug: "visits",
          name: "Visits",
          parentNodeRef: "sales",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
        {
          kind: "create",
          nodeType: "skill",
          slug: "weekly-report",
          name: "Weekly Report",
          description: "Compile the weekly sales report every Friday",
          parentNodeRef: "sales",
        },
        // Built-in scenarios only: a Base with no custom prompts.
        {
          kind: "create",
          nodeType: "base",
          slug: "leads",
          name: "Leads",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
      ]),
    );
    const visitsId = idOf(ids, "visits");
    const skillId = idOf(ids, "weekly-report");
    await asManager(() =>
      raw.nodes.updateAgentPrompts({ nodeId: visitsId, agentPrompts: VISIT_PROMPTS }),
    );

    // I1 — through the real OpenAPI handler (POST body over HTTP).
    const handler = new OpenAPIHandler(busabaseRouter);
    const httpResult = await asManager(() =>
      handler.handle(
        new Request(`${API}/playbooks/search`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ queries: ["customer visit", "log visit"] }),
        }),
        { context: {} },
      ),
    );
    if (!httpResult.matched) throw new Error("POST /playbooks/search matched no route");
    expect(httpResult.response.status).toBe(200);
    const searched = (await httpResult.response.json()) as Awaited<
      ReturnType<RawClient["playbooks"]["search"]>
    >;
    expect(searched.items[0]).toMatchObject({
      kind: "prompt",
      nodeId: visitsId,
      nodeName: "Visits",
      key: "log-visit",
      label: "Log a customer visit",
      intent: "change",
      path: ["Sales"],
    });
    expect(searched.items[0]?.matchedOn).toContain("label");
    expect(searched.coverage).toEqual({ skillsScanned: 1, promptNodesScanned: 1 });

    // I2 — `get` over HTTP (path params + query string), byte-identical to the
    // dialog's render for the same node and key.
    const getResult = await asManager(() =>
      handler.handle(
        new Request(`${API}/playbooks/prompt/${visitsId}?key=log-visit&locale=zh-CN`),
        { context: {} },
      ),
    );
    if (!getResult.matched) throw new Error("GET /playbooks/{kind}/{nodeId} matched no route");
    expect(getResult.response.status).toBe(200);
    const opened = (await getResult.response.json()) as Awaited<
      ReturnType<RawClient["playbooks"]["get"]>
    >;
    const dialog = buildNodeAgentPrompts(
      {
        nodeType: "base",
        nodeName: "Visits",
        nodeId: visitsId,
        spaceId: LOCAL_SPACE_ID,
        customPrompts: VISIT_PROMPTS,
      },
      "zh-CN",
      coreMessagesByLocale["zh-CN"],
    ).scenarios.find((prompt) => prompt.customKey === "log-visit");
    expect(dialog).toBeDefined();
    expect(opened.content).toBe(dialog?.body);
    expect(opened).toMatchObject({ kind: "prompt", key: "log-visit", label: "记录客户拜访" });
    // The rendered body names the target and carries the footer — it is the
    // full Ask Agent text, not the raw template.
    expect(opened.content).toContain(visitsId);
    expect(opened.content).not.toContain("{target}");

    // Without `locale` the body falls back to English, but the footer must not order the agent
    // to reply in English — it is talking to the user in the user's language.
    const unlocalized = await asManager(() =>
      raw.playbooks.get({ kind: "prompt", nodeId: visitsId, key: "log-visit" }),
    );
    const englishDialog = buildNodeAgentPrompts(
      {
        nodeType: "base",
        nodeName: "Visits",
        nodeId: visitsId,
        spaceId: LOCAL_SPACE_ID,
        customPrompts: VISIT_PROMPTS,
      },
      "en",
      coreMessagesByLocale.en,
    ).scenarios.find((prompt) => prompt.customKey === "log-visit");
    expect(englishDialog?.body).toContain("Reply to me in English.");
    expect(unlocalized.content).toBe(
      englishDialog?.body.replace("Reply to me in English.", "Reply in the user's language."),
    );
    expect(unlocalized.locale).toBe("en");

    // I3 — a CJK phrasing hits the zh-CN label; label comes back localized.
    const zh = await asManager(() => raw.playbooks.search({ queries: ["拜访"], locale: "zh-CN" }));
    expect(zh.items[0]).toMatchObject({ key: "log-visit", label: "记录客户拜访" });
    expect(zh.items[0]?.matchedOn).toContain("label");

    // I8 — a hand-written skill (no template stamp) is found by name, with its
    // description, and opens to its SKILL.md.
    const skill = await asManager(() => raw.playbooks.search({ queries: ["weekly report"] }));
    expect(skill.items[0]).toMatchObject({
      kind: "skill",
      nodeId: skillId,
      name: "Weekly Report",
      description: "Compile the weekly sales report every Friday",
    });
    const skillDoc = await asManager(() => raw.playbooks.get({ kind: "skill", nodeId: skillId }));
    expect(skillDoc.content).toContain("name: weekly-report");
    expect(skillDoc.files?.map((file) => file.path)).toContain("SKILL.md");

    // I9 — the Base type's built-in "Bulk-add records" scenario is not a playbook.
    const builtIn = await asManager(() =>
      raw.playbooks.search({ queries: ["bulk-add records", "bulk import"] }),
    );
    expect(builtIn.items).toEqual([]);
    expect(builtIn.total).toBe(0);

    // `kinds` narrows; an unknown key or a non-skill node is a 404.
    const onlySkills = await asManager(() =>
      raw.playbooks.search({ queries: ["visit", "weekly"], kinds: ["skill"] }),
    );
    expect(onlySkills.items.every((item) => item.kind === "skill")).toBe(true);
    await expect(
      asManager(() => raw.playbooks.get({ kind: "prompt", nodeId: visitsId, key: "nope" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      asManager(() => raw.playbooks.get({ kind: "skill", nodeId: visitsId })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("scores by field weight times distinct phrasings hit", async () => {
    await seedScenario("playbooks-scoring");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const ids = await asManager(() =>
      createNodes(raw, [
        // Hit by one phrasing, on the name (weight 3): score 3.
        {
          kind: "create",
          nodeType: "skill",
          slug: "invoice-export",
          name: "Invoice export",
          description: "Export to CSV",
        },
        // Hit by two phrasings, on the description (weight 2): score 2 x 2 = 4.
        {
          kind: "create",
          nodeType: "skill",
          slug: "month-close",
          name: "Month close",
          description: "Reconcile each invoice and chase every overdue payment",
        },
      ]),
    );
    const result = await asManager(() =>
      raw.playbooks.search({ queries: ["invoice", "overdue payment"] }),
    );
    expect(result.items.map((item) => item.nodeId)).toEqual([
      idOf(ids, "month-close"),
      idOf(ids, "invoice-export"),
    ]);
    expect(result.items.map((item) => item.score)).toEqual([4, 3]);
    expect(result.items[0]?.matchedOn).toEqual(["description"]);
  });

  it("I4: with two same-named skills, the one nearest nearNodeId ranks first", async () => {
    await seedScenario("playbooks-proximity");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const ids = await asManager(() =>
      createNodes(raw, [
        { kind: "create", nodeType: "folder", slug: "ops", name: "Ops", ref: "ops" },
        { kind: "create", nodeType: "folder", slug: "sales", name: "Sales", ref: "sales" },
        {
          kind: "create",
          nodeType: "skill",
          slug: "ops-weekly-report",
          name: "Weekly Report",
          description: "Weekly report",
          parentNodeRef: "ops",
        },
        {
          kind: "create",
          nodeType: "skill",
          slug: "sales-weekly-report",
          name: "Weekly Report",
          description: "Weekly report",
          parentNodeRef: "sales",
        },
        {
          kind: "create",
          nodeType: "base",
          slug: "pipeline",
          name: "Pipeline",
          parentNodeRef: "sales",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
      ]),
    );
    const salesSkill = idOf(ids, "sales-weekly-report");
    const opsSkill = idOf(ids, "ops-weekly-report");

    const nearSales = await asManager(() =>
      raw.playbooks.search({ queries: ["weekly report"], nearNodeId: idOf(ids, "pipeline") }),
    );
    expect(nearSales.items.map((item) => item.nodeId)).toEqual([salesSkill, opsSkill]);
    expect(nearSales.items[0]?.path).toEqual(["Sales"]);
    expect(nearSales.items[1]?.path).toEqual(["Ops"]);

    // Standing ON the Ops folder puts its own child first.
    const onOps = await asManager(() =>
      raw.playbooks.search({ queries: ["weekly report"], nearNodeId: idOf(ids, "ops") }),
    );
    expect(onOps.items[0]?.nodeId).toBe(opsSkill);

    // inNodeId restricts to a subtree.
    const inOps = await asManager(() =>
      raw.playbooks.search({ queries: ["weekly report"], inNodeId: idOf(ids, "ops") }),
    );
    expect(inOps.items.map((item) => item.nodeId)).toEqual([opsSkill]);
    expect(inOps.total).toBe(1);

    // The folder the user is working in is as near as its contents: with the
    // same prompt on both folders (equal score), the enclosing Sales folder wins
    // for a node inside Sales — even though Ops was edited last (newer).
    const weekly = [
      { key: "weekly", label: "Weekly report", body: "Write {target}'s weekly report." },
    ];
    for (const slug of ["sales", "ops"]) {
      await asManager(() =>
        raw.nodes.updateAgentPrompts({ nodeId: idOf(ids, slug), agentPrompts: weekly }),
      );
    }
    const enclosing = await asManager(() =>
      raw.playbooks.search({
        queries: ["weekly report"],
        kinds: ["prompt"],
        nearNodeId: idOf(ids, "pipeline"),
      }),
    );
    expect(enclosing.items.map((item) => item.nodeId)).toEqual([
      idOf(ids, "sales"),
      idOf(ids, "ops"),
    ]);
  });

  it("I5: a playbook on a node the caller cannot read is neither returned nor counted", async () => {
    await seedScenario("playbooks-acl");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const ids = await asManager(() =>
      createNodes(raw, [
        {
          kind: "create",
          nodeType: "base",
          slug: "payroll",
          name: "Payroll",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
        {
          kind: "create",
          nodeType: "base",
          slug: "visits",
          name: "Visits",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
      ]),
    );
    const payroll = idOf(ids, "payroll");
    const visits = idOf(ids, "visits");
    await asManager(async () => {
      await raw.nodes.updateAgentPrompts({
        nodeId: payroll,
        agentPrompts: [
          { key: "run-payroll", label: "Run the visit payroll", body: "Pay {target}." },
        ],
      });
      await raw.nodes.updateAgentPrompts({ nodeId: visits, agentPrompts: VISIT_PROMPTS });
      await raw.nodes.updateVisibility({ nodeId: payroll, visibility: "private" });
    });

    const manager = await asManager(() => raw.playbooks.search({ queries: ["visit"] }));
    expect(manager.items.some((item) => item.nodeId === payroll)).toBe(true);

    const member = await asMember("bob", () => raw.playbooks.search({ queries: ["visit"] }));
    expect(member.items.some((item) => item.nodeId === payroll)).toBe(false);
    expect(member.total).toBe(manager.total - 1);
    expect(member.coverage.promptNodesScanned).toBe(manager.coverage.promptNodesScanned - 1);
    // And it cannot be opened directly either — same "not found" as a missing node.
    await expect(
      asMember("bob", () =>
        raw.playbooks.get({ kind: "prompt", nodeId: payroll, key: "run-payroll" }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("I6: merging a SKILL.md change moves the node description; the old wording stops matching", async () => {
    await seedScenario("playbooks-skill-sync");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const ids = await asManager(() =>
      createNodes(raw, [
        {
          kind: "create",
          nodeType: "skill",
          slug: "triage",
          name: "Ticket Triage",
          description: "Sort incoming tickets by severity",
        },
      ]),
    );
    const skillId = idOf(ids, "triage");
    const current = await asManager(() =>
      raw.fileTrees.readFile({ type: "skill", nodeId: skillId, filePath: "SKILL.md" }),
    );
    const edited = current.content.replace(
      /^description: .*$/m,
      "description: Route refund requests to the billing queue",
    );
    expect(edited).not.toBe(current.content);
    const cr = await asManager(() =>
      raw.fileTrees.createChangeRequest({
        type: "skill",
        nodeId: skillId,
        autoMerge: true,
        message: "Retarget the skill",
        operations: [
          {
            kind: "update",
            path: "SKILL.md",
            content: edited,
            baseContentHash: current.contentHash,
          },
        ],
      }),
    );
    expect(cr.status).toBe("merged");

    const fresh = await asManager(() => raw.playbooks.search({ queries: ["refund requests"] }));
    expect(fresh.items[0]).toMatchObject({
      nodeId: skillId,
      description: "Route refund requests to the billing queue",
      // The frontmatter `name` (the slug, as seeded) did not change in this edit,
      // so the human title is kept — not overwritten with the slug.
      name: "Ticket Triage",
    });
    expect(fresh.items[0]?.matchedOn).toContain("description");
    const stale = await asManager(() => raw.playbooks.search({ queries: ["by severity"] }));
    expect(stale.items).toEqual([]);

    // A rename IN the frontmatter does rename the node.
    const afterFirst = await asManager(() =>
      raw.fileTrees.readFile({ type: "skill", nodeId: skillId, filePath: "SKILL.md" }),
    );
    const renamed = await asManager(() =>
      raw.fileTrees.createChangeRequest({
        type: "skill",
        nodeId: skillId,
        autoMerge: true,
        operations: [
          {
            kind: "update",
            path: "SKILL.md",
            content: afterFirst.content.replace(/^name: .*$/m, "name: refund-router"),
            baseContentHash: afterFirst.contentHash,
          },
        ],
      }),
    );
    expect(renamed.status).toBe("merged");
    const byNewName = await asManager(() => raw.playbooks.search({ queries: ["refund-router"] }));
    expect(byNewName.items[0]).toMatchObject({ nodeId: skillId, name: "refund-router" });

    // Broken frontmatter: the merge still succeeds and nothing is overwritten.
    const afterRename = await asManager(() =>
      raw.fileTrees.readFile({ type: "skill", nodeId: skillId, filePath: "SKILL.md" }),
    );
    const broken = await asManager(() =>
      raw.fileTrees.createChangeRequest({
        type: "skill",
        nodeId: skillId,
        autoMerge: true,
        operations: [
          {
            kind: "update",
            path: "SKILL.md",
            content: "---\nname: [unclosed\n---\n\n# Broken\n",
            baseContentHash: afterRename.contentHash,
          },
        ],
      }),
    );
    expect(broken.status).toBe("merged");
    const skills = await asManager(() => raw.nodes.list({ types: ["skill"] }));
    const unchanged = skills.find((node) => node.id === skillId);
    expect(unchanged).toMatchObject({
      name: "refund-router",
      description: "Route refund requests to the billing queue",
    });
  });

  it("I7: browse returns the 30 nearest and says it truncated; limit holds for a search", async () => {
    const { db } = await seedScenario("playbooks-browse");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const operations = Array.from({ length: 200 }, (_, index) => ({
      kind: "create" as const,
      nodeType: "folder" as const,
      slug: `desk-${index}`,
      name: `Desk ${index}`,
    }));
    const ids = await asManager(() => createNodes(raw, operations));
    const nodeIds = operations.map((op) => idOf(ids, op.slug));
    // Written straight to the column: 200 endpoint round trips would test the
    // write endpoint, not discovery.
    await db
      .update(busabaseNodes)
      .set({
        agentPrompts: [
          { key: "file-report", label: "File the desk report", body: "Report on {target}." },
        ],
      })
      .where(inArray(busabaseNodes.id, nodeIds));

    const browse = await asManager(() => raw.playbooks.search({ queries: [] }));
    expect(browse.items).toHaveLength(30);
    expect(browse.total).toBe(200);
    expect(browse.truncated).toBe(true);
    expect(browse.coverage.promptNodesScanned).toBe(200);

    const searched = await asManager(() =>
      raw.playbooks.search({ queries: ["desk report"], limit: 7 }),
    );
    expect(searched.items).toHaveLength(7);
    expect(searched.total).toBe(200);
    expect(searched.truncated).toBe(true);

    // A corrupt jsonb list is skipped whole, never an error.
    await db
      .update(busabaseNodes)
      .set({ agentPrompts: [{ nope: true }, "garbage"] })
      .where(eq(busabaseNodes.id, nodeIds[0] as string));
    const afterCorrupt = await asManager(() => raw.playbooks.search({ queries: ["desk report"] }));
    expect(afterCorrupt.total).toBe(199);
  });
});

describe("playbooks.list (dashboard Playbooks page)", () => {
  it("lists every readable playbook by folder, skills first, then name — and honours ACL, kinds and locale", async () => {
    await seedScenario("playbooks-list");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const longBody = `Pay {target}.${" Check every line twice.".repeat(20)}`;
    const ids = await asManager(() =>
      createNodes(raw, [
        { kind: "create", nodeType: "folder", slug: "sales", name: "Sales", ref: "sales" },
        { kind: "create", nodeType: "folder", slug: "ops", name: "Ops", ref: "ops" },
        {
          kind: "create",
          nodeType: "base",
          slug: "visits",
          name: "Visits",
          parentNodeRef: "sales",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
        {
          kind: "create",
          nodeType: "skill",
          slug: "weekly-report",
          name: "Weekly Report",
          description: "Compile the weekly sales report",
          parentNodeRef: "sales",
        },
        {
          kind: "create",
          nodeType: "skill",
          slug: "ops-digest",
          name: "Ops Digest",
          description: "Summarize the ops channel",
          parentNodeRef: "ops",
        },
        {
          kind: "create",
          nodeType: "skill",
          slug: "zeta-root-skill",
          name: "Zeta Root Skill",
          description: "Lives at the workspace root",
        },
        {
          kind: "create",
          nodeType: "base",
          slug: "payroll",
          name: "Payroll",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
      ]),
    );
    const visits = idOf(ids, "visits");
    const payroll = idOf(ids, "payroll");
    await asManager(async () => {
      await raw.nodes.updateAgentPrompts({ nodeId: visits, agentPrompts: VISIT_PROMPTS });
      await raw.nodes.updateAgentPrompts({
        nodeId: payroll,
        agentPrompts: [{ key: "run-payroll", label: "Run payroll", body: longBody }],
      });
      await raw.nodes.updateVisibility({ nodeId: payroll, visibility: "private" });
    });

    const manager = await asManager(() => raw.playbooks.list({}));
    const summary = (items: typeof manager.items) =>
      items.map((item) => [item.path.join("/"), item.kind, item.name ?? item.label]);
    // Root group first (skills before prompts), then folders alphabetically;
    // within a folder skills before prompts, each sorted by name/label.
    expect(summary(manager.items)).toEqual([
      ["", "skill", "Zeta Root Skill"],
      ["", "prompt", "Run payroll"],
      ["Ops", "skill", "Ops Digest"],
      ["Sales", "skill", "Weekly Report"],
      ["Sales", "prompt", "Log a customer visit"],
      ["Sales", "prompt", "Summarize this month's visits"],
    ]);
    expect(manager.total).toBe(6);
    expect(manager.truncated).toBe(false);

    const weekly = manager.items.find((item) => item.name === "Weekly Report");
    expect(weekly).toMatchObject({
      kind: "skill",
      nodeType: "skill",
      nodeSlug: "weekly-report",
      description: "Compile the weekly sales report",
    });
    expect(weekly?.bodyPreview).toBeUndefined();
    const summaryPrompt = manager.items.find((item) => item.key === "visit-summary");
    expect(summaryPrompt).toMatchObject({
      kind: "prompt",
      nodeId: visits,
      nodeName: "Visits",
      nodeSlug: "visits",
      intent: "read-only",
      bodyPreview: "Read Visits and summarize this month's visits by account.",
    });
    // A long body is cut to a one-line preview.
    const payrollPrompt = manager.items.find((item) => item.key === "run-payroll");
    expect(payrollPrompt?.bodyPreview?.length).toBeLessThanOrEqual(200);
    expect(payrollPrompt?.bodyPreview?.endsWith("…")).toBe(true);
    expect(payrollPrompt?.intent).toBe("change");

    // ACL: a member sees only what they can read. New skills start private to
    // their creator; Weekly Report is opened to the workspace, the other two
    // skills and the private Payroll base stay hidden — neither shown nor counted.
    await asManager(() =>
      raw.nodes.updateVisibility({ nodeId: idOf(ids, "weekly-report"), visibility: "workspace" }),
    );
    const member = await asMember("bob", () => raw.playbooks.list({}));
    expect(summary(member.items)).toEqual([
      ["Sales", "skill", "Weekly Report"],
      ["Sales", "prompt", "Log a customer visit"],
      ["Sales", "prompt", "Summarize this month's visits"],
    ]);
    expect(member.total).toBe(3);
    expect(member.items.some((item) => item.nodeId === payroll)).toBe(false);

    // kinds filter.
    const skillsOnly = await asManager(() => raw.playbooks.list({ kinds: ["skill"] }));
    expect(skillsOnly.items.map((item) => item.kind)).toEqual(["skill", "skill", "skill"]);
    const promptsOnly = await asManager(() => raw.playbooks.list({ kinds: ["prompt"] }));
    expect(promptsOnly.items.every((item) => item.kind === "prompt")).toBe(true);
    expect(promptsOnly.total).toBe(3);

    // locale picks the label and body preview in that language.
    const zh = await asManager(() => raw.playbooks.list({ kinds: ["prompt"], locale: "zh-CN" }));
    expect(zh.items.find((item) => item.key === "log-visit")).toMatchObject({
      label: "记录客户拜访",
      bodyPreview: "在 Visits 里为今天的客户拜访新增一条记录：拜访对象、讨论内容、下一步。",
    });
  });

  it("previews a prompt body for reading: {target} on its own line is dropped, inline it reads as the node name", async () => {
    await seedScenario("playbooks-list-preview");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const ids = await asManager(() =>
      createNodes(raw, [
        {
          kind: "create",
          nodeType: "base",
          slug: "tickets",
          name: "Tickets",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        },
      ]),
    );
    await asManager(() =>
      raw.nodes.updateAgentPrompts({
        nodeId: idOf(ids, "tickets"),
        agentPrompts: [
          { key: "own-line", label: "Triage", body: "{target}\n\nTriage today's new tickets." },
          { key: "inline", label: "Close", body: "Close the stale rows in {target} after a week." },
        ],
      }),
    );
    const list = await asManager(() => raw.playbooks.list({ kinds: ["prompt"] }));
    const preview = (key: string) => list.items.find((item) => item.key === key)?.bodyPreview;
    expect(preview("own-line")).toBe("Triage today's new tickets.");
    expect(preview("inline")).toBe("Close the stale rows in Tickets after a week.");
  });
});
