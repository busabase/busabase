import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../../../i18n/messages";
import { dashboardZhCN } from "../../../i18n/zh-CN";
import { buildNodeAgentPrompts, type NodePromptContext } from "./node-agent-prompts";
import {
  fillPromptSlots,
  hasPromptSlots,
  listPromptSlots,
  parsePromptTemplate,
} from "./prompt-slots";

const TEMPLATE =
  "Summarize it. Length: {{slot:Length|a few bullet points|a few bullet points,one short paragraph}}. Done.";

describe("prompt slots", () => {
  it("parses a slot with a default and options, keeping the text around it", () => {
    const parts = parsePromptTemplate(TEMPLATE);
    expect(parts).toEqual([
      { kind: "text", text: "Summarize it. Length: " },
      {
        kind: "slot",
        slot: {
          name: "Length",
          defaultValue: "a few bullet points",
          options: ["a few bullet points", "one short paragraph"],
        },
      },
      { kind: "text", text: ". Done." },
    ]);
  });

  it("fills the default when nothing was chosen, and the chosen value otherwise", () => {
    expect(fillPromptSlots(TEMPLATE)).toBe("Summarize it. Length: a few bullet points. Done.");
    expect(fillPromptSlots(TEMPLATE, { Length: "one short paragraph" })).toBe(
      "Summarize it. Length: one short paragraph. Done.",
    );
    // A blank answer is not an answer: fall back to the default.
    expect(fillPromptSlots(TEMPLATE, { Length: "   " })).toBe(
      "Summarize it. Length: a few bullet points. Done.",
    );
  });

  it("supports free-text slots and keeps the default inside its options", () => {
    const slots = listPromptSlots(
      "Translate into {{slot:Language|English}} and {{slot:Tone|warm|formal,casual}}.",
    );
    expect(slots).toEqual([
      { name: "Language", defaultValue: "English", options: [] },
      { name: "Tone", defaultValue: "warm", options: ["warm", "formal", "casual"] },
    ]);
  });

  it("never lets a typed value smuggle slot syntax into the output", () => {
    const filled = fillPromptSlots("Use {{slot:Language|English}}.", {
      Language: "{{slot:x|y}} French }}",
    });
    expect(filled).not.toContain("{{");
    expect(filled).not.toContain("}}");
    expect(filled).toContain("French");
  });

  it("is the identity on text without slots, including look-alikes", () => {
    for (const text of ["Plain body.", "Uses {target} and {{not a slot}}.", "{{slot:broken"]) {
      expect(fillPromptSlots(text)).toBe(text);
      expect(hasPromptSlots(text)).toBe(false);
    }
  });
});

describe("built-in prompts with slots", () => {
  const BASE: NodePromptContext = { nodeType: "base", nodeName: "Posts", nodeId: "nod_posts" };

  it("ships bodies with defaults filled and keeps the template alongside", () => {
    for (const [locale, messages] of [
      ["en", coreMessagesEn],
      ["zh-CN", dashboardZhCN],
    ] as const) {
      const { scenarios } = buildNodeAgentPrompts(BASE, locale, messages);
      const summarize = scenarios.find((prompt) => prompt.key === "base-summarize");
      expect(summarize?.bodyTemplate).toContain("{{slot:");
      expect(summarize?.body).not.toContain("{{slot:");
      expect(fillPromptSlots(summarize?.bodyTemplate ?? "")).toBe(summarize?.body);
    }
  });

  it("never leaks slot syntax into any built-in body, in any scope", () => {
    for (const scope of [
      undefined,
      { kind: "record", recordId: "rec_1" } as const,
      { kind: "cell", recordId: "rec_1", fieldName: "Title", fieldSlug: "title" } as const,
    ]) {
      const { scenarios, capabilities } = buildNodeAgentPrompts(
        { ...BASE, scope },
        "en",
        coreMessagesEn,
      );
      for (const prompt of [...scenarios, ...capabilities]) {
        expect(prompt.body).not.toContain("{{slot:");
      }
    }
  });

  it("leaves custom prompts untouched unless their author used the syntax", () => {
    const { scenarios } = buildNodeAgentPrompts(
      {
        ...BASE,
        customPrompts: [
          { key: "plain", label: "Plain", body: "Use {{double braces}} as-is." },
          { key: "slotted", label: "Slotted", body: "Answer in {{slot:Language|English}}." },
        ],
      },
      "en",
      coreMessagesEn,
    );
    const plain = scenarios.find((prompt) => prompt.key === "custom:plain");
    const slotted = scenarios.find((prompt) => prompt.key === "custom:slotted");
    expect(plain?.body).toContain("Use {{double braces}} as-is.");
    expect(plain?.bodyTemplate).toBeUndefined();
    expect(slotted?.body).toContain("Answer in English.");
    expect(slotted?.bodyTemplate).toContain("{{slot:Language|English}}");
  });
});
