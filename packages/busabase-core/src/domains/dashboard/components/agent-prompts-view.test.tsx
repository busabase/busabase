import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesEn } from "../../../i18n/messages";
import { buildNodeAgentPrompts, type NodePrompt } from "../helpers/node-agent-prompts";
import {
  type AgentPromptsLayout,
  AgentPromptsView,
  buildPromptSections,
  resolveActivePrompt,
} from "./agent-prompts-view";

const prompt = (key: string, tier: NodePrompt["tier"], group: string): NodePrompt => ({
  key,
  tier,
  group,
  label: key,
  body: `${key} body`,
});

const renderView = (layout?: AgentPromptsLayout) =>
  renderToStaticMarkup(
    <CoreI18nProvider locale="en">
      <AgentPromptsView
        askAgent={null}
        capabilities={[prompt("create-file", "capability", "Content")]}
        layout={layout}
        onHandedOff={() => {}}
        scenarios={[prompt("draft-video", "scenario", "Scenarios")]}
      />
    </CoreI18nProvider>,
  );

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
    ).toEqual(["doc-ask", "doc-draft", "doc-review"]);
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

describe("Agent prompt layouts", () => {
  it("renders the full-height page workspace with a readable preview surface", () => {
    const markup = renderView("page");

    expect(markup).toContain('data-layout="page"');
    expect(markup).toContain('<nav aria-label="Agent prompts"');
    expect(markup).toContain("<pre");
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain("grid-rows-[14rem_minmax(0,1fr)]");
    expect(markup).toContain("md:grid-cols-[17rem_minmax(0,1fr)]");
    expect(markup).toContain("flex-col");
    expect(markup).toContain("md:flex-row");
    expect(markup).not.toContain("shadow-sm");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain("max-w-[80ch]");
  });

  it("keeps the existing compact textarea layout as the default", () => {
    const markup = renderView();

    expect(markup).toContain('data-layout="compact"');
    expect(markup).toContain("<textarea");
    expect(markup).not.toContain('data-layout="page"');
  });
});
