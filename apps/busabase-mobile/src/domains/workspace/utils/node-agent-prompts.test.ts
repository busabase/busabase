import { describe, expect, it } from "vitest";
import { buildNodeAgentPrompts } from "./node-agent-prompts";

const context = {
  nodeType: "base",
  nodeName: "Contacts",
  nodeId: "node_1",
};

describe("buildNodeAgentPrompts", () => {
  it("binds target and space identifiers through the shared prompt rules", () => {
    const withoutSpace = buildNodeAgentPrompts(context, "en");
    expect(withoutSpace.scenarios[0].body).toContain('"Contacts" (nodeId: node_1)');
    expect(withoutSpace.scenarios[0].body).not.toContain("spaceId");

    const withSpace = buildNodeAgentPrompts(
      { ...context, spaceId: "space_1", spaceName: "Acme" },
      "en",
    );
    expect(withSpace.scenarios[0].body).toContain('space "Acme" (spaceId: space_1)');
  });

  it("uses the shared approval and reply guidance for each mobile locale", () => {
    const english = buildNodeAgentPrompts(context, "en");
    expect(english.scenarios[0].body).toContain("never merge it without my approval");
    expect(english.scenarios[0].body).toContain("Reply to me in English");

    const chinese = buildNodeAgentPrompts(context, "zh-CN");
    expect(chinese.scenarios[0].body).toContain("未经我批准绝不要合并");
    expect(chinese.scenarios[0].body).toContain("请用简体中文回复我");
  });

  it("leaves no unresolved tokens in shared prompts", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      for (const nodeType of ["base", "doc", "drive", "skill", "airapp", "form", "folder"]) {
        const { scenarios, capabilities } = buildNodeAgentPrompts(
          { ...context, nodeType, spaceId: "space_1", spaceName: "Acme" },
          locale,
        );
        for (const prompt of [...scenarios, ...capabilities]) {
          expect(prompt.body).not.toMatch(/\{[a-zA-Z]+\}/);
        }
      }
    }
  });

  it("uses shared scenario coverage and registry capabilities", () => {
    for (const nodeType of ["base", "doc", "drive", "skill", "airapp", "form"]) {
      expect(
        buildNodeAgentPrompts({ ...context, nodeType }, "en").scenarios.length,
      ).toBeGreaterThan(0);
    }
    expect(buildNodeAgentPrompts({ ...context, nodeType: "folder" }, "en").scenarios).toHaveLength(
      0,
    );

    const keys = buildNodeAgentPrompts(context, "en").capabilities.map((prompt) => prompt.key);
    expect(keys).toContain("record_create");
    expect(keys).toContain("base_add_field");
    expect(keys).toContain("node_rename");
    expect(keys).toContain("node_delete");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps each capability group contiguous", () => {
    const capabilities = buildNodeAgentPrompts(context, "en").capabilities;
    const seen: string[] = [];
    for (const prompt of capabilities) {
      if (seen.at(-1) !== prompt.group) seen.push(prompt.group);
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen[0]).toBe("Records");
    expect(seen.at(-1)).toBe("General");
  });
});
