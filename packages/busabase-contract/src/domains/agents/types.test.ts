import { describe, expect, it } from "vitest";
import { AgentSessionModelOptionVOSchema, PromptAgentSessionInputSchema } from "./types";

const presentation = { version: 1, source: "node-context", text: "My exact words" };

describe("per-model thinking capabilities", () => {
  it("preserves advertised defaults through the response boundary without requiring them from older agents", () => {
    const plain = { value: "auto", name: "Auto" };
    const capable = {
      value: "reasoner",
      name: "Reasoner",
      thinking: {
        id: "effort",
        name: "Thinking",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
    };
    const model = { id: "model", name: "Model", currentValue: "auto", options: [plain, capable] };
    expect(AgentSessionModelOptionVOSchema.parse(model)).toEqual(model);
    expect(AgentSessionModelOptionVOSchema.parse({ ...model, options: [plain] }).options).toEqual([
      plain,
    ]);
    expect(
      AgentSessionModelOptionVOSchema.safeParse({
        ...model,
        options: [{ ...capable, thinking: { ...capable.thinking, currentValue: true } }],
      }).success,
    ).toBe(false);
  });
});

describe("legacy prompt presentation contract", () => {
  it("retains explicit presentation without interpreting the full prompt", () => {
    const input = { sessionId: "s1", text: "Official context\n\nMy exact words", presentation };
    expect(PromptAgentSessionInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    { ...presentation, version: 2 },
    { ...presentation, source: "unknown" },
    { ...presentation, text: null },
  ])("rejects unsupported presentation %j at the RPC boundary", (invalid) => {
    expect(
      PromptAgentSessionInputSchema.safeParse({
        sessionId: "s1",
        text: "hello",
        presentation: invalid,
      }).success,
    ).toBe(false);
  });

  it("rejects context-only sends with no real user text or attachment", () => {
    expect(
      PromptAgentSessionInputSchema.safeParse({
        sessionId: "s1",
        text: "Official context",
        presentation: { ...presentation, text: " " },
      }).success,
    ).toBe(false);
  });

  it("rejects empty wire text even when presentation has a visible body", () => {
    expect(
      PromptAgentSessionInputSchema.safeParse({
        sessionId: "s1",
        text: " ",
        presentation,
      }).success,
    ).toBe(false);
  });

  it("accepts an attachment-only send with an intentionally empty visible body", () => {
    expect(
      PromptAgentSessionInputSchema.safeParse({
        sessionId: "s1",
        text: "Official context",
        presentation: { ...presentation, text: "" },
        attachments: [{ kind: "image", data: "QUJD", mimeType: "image/png" }],
      }).success,
    ).toBe(true);
  });
});

describe("explicit page reference contract", () => {
  it("accepts a reference-only message without legacy display metadata", () => {
    const input = { sessionId: "s1", text: "", contextReferences: [{ nodeId: "nod_doc" }] };
    expect(PromptAgentSessionInputSchema.parse(input)).toEqual(input);
  });

  it("preserves literal user text alongside selected references and files", () => {
    const input = {
      sessionId: "s1",
      text: "Target: this is my own text, keep it.",
      contextReferences: [{ nodeId: "nod_doc" }],
      attachments: [{ kind: "file", data: "QUJD", mimeType: "text/plain", filename: "notes.txt" }],
    };
    expect(PromptAgentSessionInputSchema.parse(input)).toEqual(input);
  });

  it("rejects a blank send after the last reference is removed", () => {
    expect(
      PromptAgentSessionInputSchema.safeParse({
        sessionId: "s1",
        text: " ",
        contextReferences: [],
      }).success,
    ).toBe(false);
  });
});
