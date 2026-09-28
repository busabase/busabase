import { createRouterClient } from "@orpc/server";
import { customAgentPromptsSchema } from "busabase-contract/contract/node-agent-prompt-schemas";
import { describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { DEMO_CRM_COMPANIES_BASE_NODE_ID, DEMO_ROOT_NODE_ID } from "../src/demo/dataset";
import { DEMO_NODE_AGENT_PROMPTS, DEMO_PLAYBOOK_USAGE } from "../src/demo/playbooks";
import { coreMessagesByLocale } from "../src/i18n/catalog";
import { demoListNodes } from "../src/logic/demo-store";
import { busabaseDemoRouter } from "../src/router-demo";

/**
 * Playbooks are the product's newest core idea — "write down how your team
 * does it once, and every agent looks it up first" — and the demo is the public
 * tour. The demo used to refuse every playbook read, so /playbooks showed an
 * error. It now serves seeded prompts and skills through the same builder and
 * ranking as the real store.
 */
const client = createRouterClient(busabaseDemoRouter);
const inLocale = <T>(locale: "en" | "zh-CN", fn: () => Promise<T>) =>
  runWithBusabaseContext({ demoLocale: locale }, fn);

const flatten = (nodes: ReturnType<typeof demoListNodes>): ReturnType<typeof demoListNodes> =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe("demo playbooks", () => {
  it("seeds only valid prompts, on nodes that exist in every demo locale", async () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const ids = new Set(
        (await inLocale(locale, async () => flatten(demoListNodes()))).map((node) => node.id),
      );
      for (const [nodeId, prompts] of Object.entries(DEMO_NODE_AGENT_PROMPTS)) {
        // A prompt on a missing node, or one the schema rejects, would vanish
        // from the demo without an error — exactly what this guards against.
        expect(ids.has(nodeId), `${nodeId} exists in the ${locale} demo`).toBe(true);
        expect(customAgentPromptsSchema.safeParse(prompts).success).toBe(true);
      }
    }
  });

  it("lists skills and every seeded prompt, with usage on the ones agents used", async () => {
    const promptCount = Object.values(DEMO_NODE_AGENT_PROMPTS).flat().length;
    for (const locale of ["en", "zh-CN"] as const) {
      const result = await inLocale(locale, () => client.playbooks.list({ locale }));
      const skills = result.items.filter((item) => item.kind === "skill");
      const prompts = result.items.filter((item) => item.kind === "prompt");
      expect(skills.length).toBeGreaterThanOrEqual(2);
      expect(prompts).toHaveLength(promptCount);
      expect(result.total).toBe(result.items.length);

      const logVisit = prompts.find(
        (item) => item.nodeId === DEMO_CRM_COMPANIES_BASE_NODE_ID && item.key === "log-visit",
      );
      expect(logVisit?.label).toBe(locale === "zh-CN" ? "记一次客户拜访" : "Log a customer visit");
      expect(logVisit?.usage?.changeRequests30d).toBe(
        DEMO_PLAYBOOK_USAGE[`prompt:${DEMO_CRM_COMPANIES_BASE_NODE_ID}:log-visit`]
          ?.changeRequests30d,
      );
      // Read-only prompts write no change request, so they have no usage — the
      // same rule the real usage count follows.
      for (const item of prompts.filter((prompt) => prompt.intent === "read-only")) {
        expect(item.usage?.changeRequests30d).toBe(0);
      }
    }
  });

  it("finds the right playbook for the page's own 'Try it' example sentence", async () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const sentence = coreMessagesByLocale[locale].playbooksPage.tryPlaceholder.replace(
        /^(e\.g\. |例如：)/,
        "",
      );
      const result = await inLocale(locale, () =>
        client.playbooks.search({ queries: [sentence], locale }),
      );
      expect(result.items[0]).toMatchObject({
        kind: "prompt",
        nodeId: DEMO_CRM_COMPANIES_BASE_NODE_ID,
        key: "log-visit",
      });
    }
  });

  it("returns an empty result, not an error, for a sentence nothing matches", async () => {
    const result = await client.playbooks.search({ queries: ["zzz no such playbook zzz"] });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("renders a prompt exactly as an agent receives it, and a skill's SKILL.md", async () => {
    const prompt = await inLocale("zh-CN", () =>
      client.playbooks.get({
        kind: "prompt",
        nodeId: DEMO_CRM_COMPANIES_BASE_NODE_ID,
        key: "log-visit",
        locale: "zh-CN",
      }),
    );
    expect(prompt.kind).toBe("prompt");
    if (prompt.kind !== "prompt") throw new Error("expected a prompt");
    expect(prompt.content).toContain(DEMO_CRM_COMPANIES_BASE_NODE_ID);
    expect(prompt.content).toContain("把今天的拜访记到对应的客户上");

    const skill = await client.playbooks.get({
      kind: "skill",
      nodeId: "nod_skill_ai_research_editor",
    });
    expect(skill.kind).toBe("skill");
    if (skill.kind !== "skill") throw new Error("expected a skill");
    expect(skill.content).toMatch(/^---\nname: ai-research-editor/);
    expect(skill.files.map((file) => file.path)).toContain("SKILL.md");
  });

  it("serves the same prompts to the Ask Agent dialog, and none on other nodes", async () => {
    const withPrompts = await client.nodes.getAgentPrompts({
      nodeId: DEMO_CRM_COMPANIES_BASE_NODE_ID,
    });
    expect(withPrompts.agentPrompts).toEqual(
      DEMO_NODE_AGENT_PROMPTS[DEMO_CRM_COMPANIES_BASE_NODE_ID],
    );
    const without = await client.nodes.getAgentPrompts({ nodeId: DEMO_ROOT_NODE_ID });
    expect(without.agentPrompts).toBeNull();
  });
});
