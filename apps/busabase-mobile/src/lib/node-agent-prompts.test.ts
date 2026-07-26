import { describe, expect, it } from "vitest";
import { en, zhCN } from "~/i18n/messages";
import { buildNodeAgentPrompts } from "./node-agent-prompts";

const context = {
  nodeType: "base",
  nodeName: "Contacts",
  nodeId: "node_1",
};

describe("buildNodeAgentPrompts", () => {
  it("names the node, and the space when one is known", () => {
    const withoutSpace = buildNodeAgentPrompts(context, en);
    expect(withoutSpace.scenarios[0].body).toContain('"Contacts" (nodeId: node_1)');
    expect(withoutSpace.scenarios[0].body).not.toContain("spaceId");

    const withSpace = buildNodeAgentPrompts(
      { ...context, spaceId: "space_1", spaceName: "Acme" },
      en,
    );
    expect(withSpace.scenarios[0].body).toContain('in space "Acme" (spaceId: space_1)');
  });

  it("appends the approval-first footer to every prompt, in the active locale", () => {
    const { scenarios, capabilities } = buildNodeAgentPrompts(context, en);
    for (const prompt of [...scenarios, ...capabilities]) {
      expect(prompt.body.endsWith(en.agentPrompts.footer)).toBe(true);
    }
    const zh = buildNodeAgentPrompts(context, zhCN);
    expect(zh.scenarios[0].body.endsWith(zhCN.agentPrompts.footer)).toBe(true);
    expect(zh.scenarios[0].label).toBe(zhCN.agentPrompts.baseBulkImportLabel);
  });

  it("leaves no unresolved {token} placeholders in any prompt body", () => {
    for (const messages of [en, zhCN]) {
      for (const nodeType of ["base", "doc", "drive", "skill", "airapp", "folder"]) {
        const { scenarios, capabilities } = buildNodeAgentPrompts(
          { ...context, nodeType, spaceId: "space_1", spaceName: "Acme" },
          messages,
        );
        for (const prompt of [...scenarios, ...capabilities]) {
          expect(prompt.body).not.toMatch(/\{[a-zA-Z]+\}/);
        }
      }
    }
  });

  it("curates scenarios only for the types web curates them for", () => {
    for (const nodeType of ["base", "doc", "drive", "skill", "airapp"]) {
      expect(buildNodeAgentPrompts({ ...context, nodeType }, en).scenarios.length).toBeGreaterThan(
        0,
      );
    }
    // A folder has no curated scenarios — the sheet falls back to Capabilities.
    expect(buildNodeAgentPrompts({ ...context, nodeType: "folder" }, en).scenarios).toHaveLength(0);
  });

  it("derives capabilities from the registry, including the generic node_* ops", () => {
    const { capabilities } = buildNodeAgentPrompts(context, en);
    const keys = capabilities.map((prompt) => prompt.key);
    expect(keys).toContain("record_create");
    expect(keys).toContain("base_add_field");
    // Generic tree operations are appended for every node type.
    expect(keys).toContain("node_rename");
    expect(keys).toContain("node_delete");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("orders capability groups Records → Fields → Views → … → General", () => {
    const { capabilities } = buildNodeAgentPrompts(context, en);
    const seen: string[] = [];
    for (const prompt of capabilities) {
      if (seen.at(-1) !== prompt.group) seen.push(prompt.group);
    }
    // Each group appears exactly once — i.e. the sort never interleaves them.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen[0]).toBe(en.agentPrompts.groupRecord);
    expect(seen.at(-1)).toBe(en.agentPrompts.groupGeneral);
  });
});
