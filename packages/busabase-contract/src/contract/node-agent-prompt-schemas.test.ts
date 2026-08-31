import { describe, expect, it } from "vitest";
import {
  CUSTOM_AGENT_PROMPT_LIMITS,
  customAgentPromptsSchema,
  customPromptDefSchema,
} from "./node-agent-prompt-schemas";

const validPrompt = {
  key: "weekly-severity-summary",
  intent: "read-only" as const,
  label: { en: "Weekly severity summary", "zh-CN": "本周按严重程度汇总" },
  body: {
    en: "Summarize tickets opened in {target} in the last 7 days, grouped by severity.",
    "zh-CN": "汇总 {target} 最近 7 天新建的工单，按严重程度分组。",
  },
};

describe("customPromptDefSchema", () => {
  it("accepts a well-formed localized prompt", () => {
    expect(customPromptDefSchema.safeParse(validPrompt).success).toBe(true);
  });

  it("accepts the plain-string iString form (no translation supplied)", () => {
    const result = customPromptDefSchema.safeParse({
      key: "draft-response",
      intent: "change",
      label: "Draft a response to the selected ticket",
      body: "Draft a reply to the ticket currently selected in {target}, matching our support tone.",
    });
    expect(result.success).toBe(true);
  });

  it("defaults intent to unset (caller treats missing as change, same as curated prompts)", () => {
    const result = customPromptDefSchema.safeParse({
      key: "no-intent",
      label: "Label",
      body: "Body about {target}",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.intent).toBeUndefined();
  });

  it("rejects an empty key", () => {
    const result = customPromptDefSchema.safeParse({ ...validPrompt, key: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a label over the per-locale character limit", () => {
    const result = customPromptDefSchema.safeParse({
      ...validPrompt,
      label: { en: "x".repeat(CUSTOM_AGENT_PROMPT_LIMITS.maxLabelChars + 1) },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["label"]);
      expect(result.error.issues[0]?.message).toContain("80 characters");
    }
  });

  it("accepts a label exactly at the character limit", () => {
    const result = customPromptDefSchema.safeParse({
      ...validPrompt,
      label: { en: "x".repeat(CUSTOM_AGENT_PROMPT_LIMITS.maxLabelChars) },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a body over the per-locale byte limit, counting UTF-8 bytes not characters", () => {
    // Each CJK character here is 3 bytes in UTF-8, so far fewer characters than
    // the byte limit already exceed it — this is exactly the gap a character-count
    // check would miss.
    const cjkChar = "汇";
    const overBudget = cjkChar.repeat(Math.ceil(CUSTOM_AGENT_PROMPT_LIMITS.maxBodyBytes / 3) + 1);
    const result = customPromptDefSchema.safeParse({
      ...validPrompt,
      body: { en: overBudget },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["body"]);
      expect(result.error.issues[0]?.message).toContain("8192 bytes");
    }
  });

  it("accepts a body exactly at the byte limit", () => {
    const result = customPromptDefSchema.safeParse({
      ...validPrompt,
      body: { en: "a".repeat(CUSTOM_AGENT_PROMPT_LIMITS.maxBodyBytes) },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid locale key", () => {
    const result = customPromptDefSchema.safeParse({
      ...validPrompt,
      label: { xx: "Not a real locale" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid intent value", () => {
    const result = customPromptDefSchema.safeParse({ ...validPrompt, intent: "delete-everything" });
    expect(result.success).toBe(false);
  });
});

describe("customAgentPromptsSchema", () => {
  it("accepts an empty array", () => {
    expect(customAgentPromptsSchema.safeParse([]).success).toBe(true);
  });

  it("accepts a list at exactly the max prompt count", () => {
    const prompts = Array.from({ length: CUSTOM_AGENT_PROMPT_LIMITS.maxPrompts }, (_, i) => ({
      ...validPrompt,
      key: `prompt-${i}`,
    }));
    expect(customAgentPromptsSchema.safeParse(prompts).success).toBe(true);
  });

  it("rejects a list over the max prompt count", () => {
    const prompts = Array.from({ length: CUSTOM_AGENT_PROMPT_LIMITS.maxPrompts + 1 }, (_, i) => ({
      ...validPrompt,
      key: `prompt-${i}`,
    }));
    const result = customAgentPromptsSchema.safeParse(prompts);
    expect(result.success).toBe(false);
  });

  it("rejects duplicate keys and names the offending entry", () => {
    const prompts = [
      { ...validPrompt, key: "dup" },
      { ...validPrompt, key: "dup" },
    ];
    const result = customAgentPromptsSchema.safeParse(prompts);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.message.includes("duplicate key"));
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual([1, "key"]);
      expect(issue?.message).toContain('"dup"');
      expect(issue?.message).toContain("entry 1");
    }
  });

  it("accumulates a distinct issue per malformed entry so the caller can report all of them", () => {
    const prompts = [
      { ...validPrompt, key: "ok" },
      { ...validPrompt, key: "", label: { en: "fine" } },
      { ...validPrompt, key: "also-ok", label: { en: "x".repeat(200) } },
    ];
    const result = customAgentPromptsSchema.safeParse(prompts);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 1 && i.path[1] === "key")).toBe(true);
      expect(result.error.issues.some((i) => i.path[0] === 2 && i.path[1] === "label")).toBe(true);
    }
  });
});
