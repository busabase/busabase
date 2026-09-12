import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../../../i18n/messages";
import { buildNodeAgentPrompts, type NodePrompt } from "../helpers/node-agent-prompts";
import { agentPromptsUpdateValue } from "../hooks/use-node-agent-prompts";
import {
  buildPromptSections,
  createCustomPromptKey,
  removeCustomPrompt,
  resolveActivePrompt,
  selectionAfterCustomPromptDelete,
  updateLocalizedPromptValue,
  upsertCustomPrompt,
  utf8ByteLength,
} from "./agent-prompts-view";

const prompt = (
  key: string,
  tier: NodePrompt["tier"],
  group: string,
  source: NodePrompt["source"] = tier === "scenario" ? "built-in-scenario" : "capability",
): NodePrompt => ({
  key,
  tier,
  source,
  group,
  label: key,
  body: `${key} body`,
});

describe("Agent prompt sidebar sections", () => {
  it("puts scenarios first and preserves capability group order", () => {
    const scenario = prompt("scenario", "scenario", "Content");
    const record = prompt("record_create", "capability", "Records");
    const field = prompt("field_create", "capability", "Fields");

    const sections = buildPromptSections([scenario], [record, field], {
      builtIn: "Built-in scenarios",
      custom: "Custom scenarios",
    });

    expect(sections.map((section) => section.name)).toEqual([
      "Built-in scenarios",
      "Records",
      "Fields",
    ]);
    expect(sections.flatMap((section) => section.items)).toEqual([scenario, record, field]);
    expect(resolveActivePrompt(sections, null)).toBe(scenario);
  });

  it("starts directly with capabilities when the node type has no scenarios", () => {
    const capability = prompt("node_update", "capability", "General");

    const sections = buildPromptSections([], [capability], {
      builtIn: "Built-in scenarios",
      custom: "Custom scenarios",
    });

    expect(sections).toEqual([{ name: "General", source: "capability", items: [capability] }]);
    expect(resolveActivePrompt(sections, null)).toBe(capability);
  });

  it("keeps an empty custom section before built-ins and capabilities for management", () => {
    const scenario = prompt("scenario", "scenario", "Content");
    const capability = prompt("node_update", "capability", "General");
    const sections = buildPromptSections([scenario], [capability], {
      builtIn: "Built-in scenarios",
      custom: "Custom scenarios",
      includeEmptyCustom: true,
    });

    expect(sections.map((section) => section.name)).toEqual([
      "Custom scenarios",
      "Built-in scenarios",
      "General",
    ]);
    expect(sections[0]?.items).toEqual([]);
  });

  it("resolves preview selection across scenario and capability sections", () => {
    const scenario = prompt("scenario", "scenario", "Content");
    const capability = prompt("record_update", "capability", "Records");
    const sections = buildPromptSections([scenario], [capability], {
      builtIn: "Built-in scenarios",
      custom: "Custom scenarios",
    });

    expect(resolveActivePrompt(sections, capability.key)).toBe(capability);
    expect(resolveActivePrompt(sections, "missing")).toBe(scenario);
  });

  it("places the Doc read prompt under Content instead of Scenarios", () => {
    const { scenarios, capabilities } = buildNodeAgentPrompts(
      {
        nodeId: "nod_doc_launch",
        nodeName: "Launch brief",
        nodeType: "doc",
        spaceId: "spc_acme",
      },
      "en",
      coreMessagesEn,
    );
    const sections = buildPromptSections(scenarios, capabilities, {
      builtIn: "Built-in scenarios",
      custom: "Custom scenarios",
    });

    expect(
      sections
        .find((section) => section.name === "Built-in scenarios")
        ?.items.map(({ key }) => key),
    ).toEqual(["doc-ask", "doc-draft", "doc-review"]);
    expect(sections.find((section) => section.name === "Content")?.items[0]?.key).toBe("doc-read");
  });

  it("places a node's custom scenarios before built-ins and keeps keys isolated", () => {
    const { scenarios, capabilities } = buildNodeAgentPrompts(
      {
        nodeId: "nod_base_support",
        nodeName: "Customer Support Tickets",
        nodeType: "base",
        spaceId: "spc_acme",
        customPrompts: [
          {
            key: "weekly-severity-summary",
            intent: "read-only" as const,
            label: "Weekly severity summary",
            body: "Summarize tickets opened in {target} in the last 7 days, grouped by severity.",
          },
        ],
      },
      "en",
      coreMessagesEn,
    );
    const sections = buildPromptSections(scenarios, capabilities, {
      builtIn: "Built-in scenarios",
      custom: "Custom scenarios",
    });

    expect(
      sections.find((section) => section.name === "Custom scenarios")?.items.map(({ key }) => key),
    ).toEqual(["custom:weekly-severity-summary"]);
    expect(sections.slice(0, 2).map((section) => section.name)).toEqual([
      "Custom scenarios",
      "Built-in scenarios",
    ]);
    expect(scenarios.map((item) => item.key)).toContain("base-bulk-import");
    expect(scenarios.find((item) => item.customKey === "weekly-severity-summary")?.source).toBe(
      "custom-scenario",
    );
  });

  it("creates stable collision-free custom keys", () => {
    expect(createCustomPromptKey("Review research draft", [])).toBe("review-research-draft");
    expect(createCustomPromptKey("Review research draft", ["review-research-draft"])).toBe(
      "review-research-draft-2",
    );
    expect(createCustomPromptKey("研究复盘", [])).toBe("custom-scenario");
  });

  it("preserves multilingual values while plain strings stay shared", () => {
    expect(updateLocalizedPromptValue("Shared", "zh-CN", "共享")).toBe("共享");
    expect(updateLocalizedPromptValue({ en: "Review", ja: "レビュー" }, "zh-CN", "审查")).toEqual({
      en: "Review",
      ja: "レビュー",
      "zh-CN": "审查",
    });
    expect(utf8ByteLength("提示")).toBe(6);
  });

  it("adds, edits, and removes only custom prompt entries", () => {
    const first = { key: "first", label: "First", body: "{target}" };
    const second = { key: "second", label: "Second", body: "Review {target}" };
    expect(upsertCustomPrompt([first], second, "create")).toEqual([first, second]);
    expect(upsertCustomPrompt([first, second], { ...second, label: "Updated" }, "edit")).toEqual([
      first,
      { ...second, label: "Updated" },
    ]);
    expect(removeCustomPrompt([first, second], "first")).toEqual([second]);
    expect(removeCustomPrompt([first], "first")).toEqual([]);
    expect(selectionAfterCustomPromptDelete([first, second], "first")).toBe("custom:second");
    expect(selectionAfterCustomPromptDelete([first, second], "second")).toBeNull();
    expect(agentPromptsUpdateValue([])).toBeNull();
    expect(agentPromptsUpdateValue([first])).toEqual([first]);
  });
});
