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
    // Selected by key, not by position. This asserted on `scenarios[0]` and passed
    // only because the first entry happened to be a mutating one — so promoting a
    // read-only scenario to the top of the shared list turned it red without any
    // mutating prompt having actually lost its approval line.
    const mutating = (result: ReturnType<typeof buildNodeAgentPrompts>) => {
      const prompt = result.scenarios.find((entry) => entry.key === "base-bulk-import");
      if (!prompt)
        throw new Error("expected the shared Base scenarios to include base-bulk-import");
      return prompt;
    };

    const english = buildNodeAgentPrompts(context, "en");
    expect(mutating(english).body).toContain("don't choose a merge policy yourself");
    expect(mutating(english).body).toContain("Reply to me in English");

    const chinese = buildNodeAgentPrompts(context, "zh-CN");
    expect(mutating(chinese).body).toContain("不要自己指定合并策略");
    expect(mutating(chinese).body).toContain("请用简体中文回复我");
  });

  it("carries the reply guidance but NOT the approval line on read-only scenarios", () => {
    // The mobile app renders the same bodies, so "read-only" has to read as
    // read-only here too — an approval line on a prompt that writes nothing is
    // the kind of wrong that only shows up in a transcript.
    for (const [locale, reply, approval] of [
      ["en", "Reply to me in English", "don't choose a merge policy yourself"],
      ["zh-CN", "请用简体中文回复我", "不要自己指定合并策略"],
    ] as const) {
      const readOnly = buildNodeAgentPrompts(context, locale).scenarios.find(
        (entry) => entry.key === "base-find",
      );
      if (!readOnly) throw new Error("expected the shared Base scenarios to include base-find");
      expect(readOnly.body).toContain(reply);
      expect(readOnly.body).not.toContain(approval);
    }
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
