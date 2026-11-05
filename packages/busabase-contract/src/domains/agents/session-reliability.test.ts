import { describe, expect, it } from "vitest";
import {
  AgentSessionCommandReceiptVOSchema,
  AgentSessionReliabilityVOSchema,
} from "./session-reliability";
import {
  AgentSessionEventVOSchema,
  AgentSessionVOSchema,
  PromptAgentSessionInputSchema,
} from "./types";

describe("additive supervised session contract", () => {
  const session = {
    id: "ags_contract",
    slug: "buda:test",
    agentName: "Test",
    transport: "remote-websocket",
    status: "idle",
    createdAt: "2026-11-03T00:00:00Z",
    lastActivityAt: "2026-11-03T00:00:00Z",
    error: null,
    modelOption: null,
  };
  it("retains legacy session and prompt responses without reliability fields", () => {
    expect(AgentSessionVOSchema.parse(session)).toEqual(session);
    expect(PromptAgentSessionInputSchema.parse({ sessionId: "ags_contract", text: "hi" })).toEqual({
      sessionId: "ags_contract",
      text: "hi",
    });
  });
  it("accepts retained command identity and rejects malformed identity", () => {
    expect(
      PromptAgentSessionInputSchema.parse({
        sessionId: "ags_contract",
        text: "hi",
        commandId: "command_retry",
      }).commandId,
    ).toBe("command_retry");
    expect(
      PromptAgentSessionInputSchema.safeParse({
        sessionId: "ags_contract",
        text: "hi",
        commandId: "a credential with spaces",
      }).success,
    ).toBe(false);
    expect(
      AgentSessionEventVOSchema.parse({
        sessionId: "ags_contract",
        seq: 1,
        commandId: "command_retry",
        kind: "status",
        status: "busy",
        at: session.createdAt,
      }).commandId,
    ).toBe("command_retry");
  });
  it("exposes orthogonal safe states and strips server ownership fields", () => {
    expect(
      AgentSessionReliabilityVOSchema.parse({
        connection: "connected",
        execution: "unknown",
        synchronization: "recovering",
        writerOwnerId: "private",
      }),
    ).toEqual({ connection: "connected", execution: "unknown", synchronization: "recovering" });
    expect(
      AgentSessionCommandReceiptVOSchema.parse({
        commandId: "command_pending",
        kind: "prompt",
        state: "queued",
        payload: { text: "hi" },
        createdAt: session.createdAt,
        expiresAt: session.createdAt,
        claimingEpoch: 12,
        receipt: { internal: true },
      }),
    ).not.toHaveProperty("claimingEpoch");
    expect(
      AgentSessionReliabilityVOSchema.safeParse({
        connection: "connected",
        execution: "made-up",
        synchronization: "synced",
      }).success,
    ).toBe(false);
  });
});
