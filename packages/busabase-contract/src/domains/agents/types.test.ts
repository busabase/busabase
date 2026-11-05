import { describe, expect, it } from "vitest";
import {
  AgentConnectionVOSchema,
  AgentSessionModelOptionVOSchema,
  AgentSessionModeOptionVOSchema,
  ConnectBudaAcpInputSchema,
  PromptAgentSessionInputSchema,
  SetAgentSessionConfigOptionInputSchema,
} from "./types";

describe("Buda ACP credentials input", () => {
  it("requires separate endpoint, agent ID and a nonempty single-line token", () => {
    const input = {
      endpoint: " wss://buda.im/api/acp ",
      agentId: " agent-1 ",
      apiToken: " token ",
    };
    expect(ConnectBudaAcpInputSchema.parse(input)).toEqual({
      endpoint: "wss://buda.im/api/acp",
      agentId: "agent-1",
      apiToken: "token",
    });
    for (const apiToken of ["", " ", "token\r\nAuthorization: bad"])
      expect(ConnectBudaAcpInputSchema.safeParse({ ...input, apiToken }).success).toBe(false);
    expect(ConnectBudaAcpInputSchema.safeParse({ ...input, agentId: "" }).success).toBe(false);
  });
});

describe("agent session modes", () => {
  it("preserves advertised mode labels, descriptions and dispatch source", () => {
    const mode = {
      id: "permission_mode",
      name: "Permissions",
      description: "Agent policy",
      source: "config",
      currentValue: "default",
      options: [{ value: "default", name: "Default", description: "Ask before changes" }],
    };
    expect(AgentSessionModeOptionVOSchema.parse(mode)).toEqual(mode);
    expect(
      AgentSessionModeOptionVOSchema.safeParse({ ...mode, source: "unsupported" }).success,
    ).toBe(false);
  });

  it("keeps existing config clients valid and constrains an explicit method", () => {
    const input = { sessionId: "s", configId: "mode", value: "ask" };
    expect(SetAgentSessionConfigOptionInputSchema.parse(input)).toEqual(input);
    expect(
      SetAgentSessionConfigOptionInputSchema.parse({ ...input, source: "legacy" }).source,
    ).toBe("legacy");
    expect(
      SetAgentSessionConfigOptionInputSchema.safeParse({ ...input, source: "custom_method" })
        .success,
    ).toBe(false);
  });
});

const presentation = { version: 1, source: "node-context", text: "My exact words" };

describe("agent connection provider identity", () => {
  const connection = {
    slug: "acprouter:opaque-device",
    agentName: "My renamed assistant",
    transport: "remote-websocket",
    sessionCount: 0,
    latest: null,
    connected: true,
    ownedByCurrentUser: true,
  };

  it("keeps the underlying provider slug while accepting older responses without it", () => {
    expect(AgentConnectionVOSchema.parse(connection)).toEqual(connection);
    const withProvider = { ...connection, providerAgentSlug: "claude-acp" };
    expect(AgentConnectionVOSchema.parse(withProvider)).toEqual(withProvider);
    expect(
      AgentConnectionVOSchema.parse({ ...withProvider, agentName: "Codex" }).providerAgentSlug,
    ).toBe("claude-acp");
  });

  it.each(["", 42, null])("rejects invalid provider metadata %j", (providerAgentSlug) => {
    expect(AgentConnectionVOSchema.safeParse({ ...connection, providerAgentSlug }).success).toBe(
      false,
    );
  });
});

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
