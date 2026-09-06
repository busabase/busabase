import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../../../i18n/messages";
import { buildNodeAgentPrompts, type NodePrompt } from "../helpers/node-agent-prompts";
import { buildPromptSections, resolveActivePrompt } from "./agent-prompts-view";

const prompt = (key: string, tier: NodePrompt["tier"], group: string): NodePrompt => ({
  key,
  tier,
  group,
  label: key,
  body: `${key} body`,
});

describe("Agent prompt sidebar sections", () => {
  it("puts scenarios first and preserves capability group order", () => {
    const scenario = prompt("scenario", "scenario", "Content");
    const record = prompt("record_create", "capability", "Records");
    const field = prompt("field_create", "capability", "Fields");

    const sections = buildPromptSections([scenario], [record, field], "Scenarios");

    expect(sections.map((section) => section.name)).toEqual(["Scenarios", "Records", "Fields"]);
    expect(sections.flatMap((section) => section.items)).toEqual([scenario, record, field]);
    expect(resolveActivePrompt(sections, null)).toBe(scenario);
  });

  it("starts directly with capabilities when the node type has no scenarios", () => {
    const capability = prompt("node_update", "capability", "General");

    const sections = buildPromptSections([], [capability], "Scenarios");

    expect(sections).toEqual([{ name: "General", items: [capability] }]);
    expect(resolveActivePrompt(sections, null)).toBe(capability);
  });

  it("resolves preview selection across scenario and capability sections", () => {
    const scenario = prompt("scenario", "scenario", "Content");
    const capability = prompt("record_update", "capability", "Records");
    const sections = buildPromptSections([scenario], [capability], "Scenarios");

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
    const sections = buildPromptSections(scenarios, capabilities, "Scenarios");

    expect(
      sections.find((section) => section.name === "Scenarios")?.items.map(({ key }) => key),
    ).toEqual(["doc-draft", "doc-review"]);
    expect(sections.find((section) => section.name === "Content")?.items[0]?.key).toBe("doc-read");
  });

  it("renders a node's custom scenario prompts (Feature 3) once they are fetched", () => {
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
    const sections = buildPromptSections(scenarios, capabilities, "Scenarios");

    expect(
      sections.find((section) => section.name === "Scenarios")?.items.map(({ key }) => key),
    ).toEqual(["weekly-severity-summary"]);
    // The generic Base scenario is gone, replaced — not merged alongside it.
    expect(scenarios.map((prompt) => prompt.key)).not.toContain("base-bulk-import");
  });
});
