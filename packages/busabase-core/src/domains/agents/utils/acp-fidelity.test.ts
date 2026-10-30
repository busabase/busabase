import { reduceAcpEvents } from "@acp-ui/core/reduce";
import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import {
  highestUpstreamSeq,
  pendingInputOf,
  translateAcpExtension,
  upstreamSeqOf,
} from "./acp-fidelity";
import { assertAgentInputResponse } from "./agent-input-validation";

const extension = (event: Record<string, unknown>, seq = 1): AgentSessionEventVO => ({
  sessionId: "outer",
  seq,
  at: "2026-10-26T10:00:00Z",
  kind: "acpExtension",
  acpExtension: {
    method: "_buda.im/session_event",
    params: { sessionId: "inner", event, _meta: { "buda.im": { seq } } },
  },
});

describe("ACP fidelity boundaries", () => {
  it("keeps a terminal event when optional SDK usage counters are null or malformed", () => {
    const event = extension({
      version: 1,
      type: "turn_finished",
      turnId: "turn",
      at: "2026-10-26T10:00:00Z",
      stopReason: "end_turn",
      usage: { inputTokens: 12, outputTokens: 3, thoughtTokens: null, cachedReadTokens: null },
    });
    expect(translateAcpExtension(event.acpExtension)).toMatchObject([
      {
        type: "lifecycle",
        event: { type: "turn_finished", usage: { inputTokens: 12, outputTokens: 3 } },
      },
    ]);
    const malformed = extension({
      version: 1,
      type: "turn_finished",
      turnId: "turn",
      at: "2026-10-26T10:00:00Z",
      stopReason: "end_turn",
      usage: { inputTokens: "unknown" },
    });
    expect(translateAcpExtension(malformed.acpExtension)).toMatchObject([
      { type: "lifecycle", event: { type: "turn_finished", stopReason: "end_turn" } },
    ]);
  });
  it("keeps source cursors distinct from local sequence numbers and skips malformed metadata", () => {
    expect(upstreamSeqOf({ acpUpdate: { _meta: { "buda.im": { seq: 0 } } } })).toBe(0);
    expect(upstreamSeqOf({ acpUpdate: { _meta: { "buda.im": { seq: "4" } } } })).toBeUndefined();
    expect(highestUpstreamSeq([extension({}, 3), { ...extension({}, 7), seq: 90 }])).toBe(7);
  });

  it("roundtrips process, resource and late turn completion identically through JSON persistence", () => {
    const events = [
      extension({ version: 1, type: "turn_started", turnId: "turn", at: "2026-10-26T10:00:00Z" }),
      extension(
        {
          version: 1,
          type: "resource_update",
          turnId: "turn",
          at: "2026-10-26T10:00:01Z",
          resource: {
            id: "report",
            uri: "buda://report",
            name: "report.pdf",
            mimeType: "application/pdf",
          },
        },
        2,
      ),
      extension(
        {
          version: 1,
          type: "turn_finished",
          turnId: "turn",
          at: "2026-10-26T10:00:02Z",
          stopReason: "max_tokens",
          usage: { inputTokens: 40, outputTokens: 12 },
        },
        3,
      ),
    ];
    const live = reduceAcpEvents(
      [],
      events.flatMap((event) => translateAcpExtension(event.acpExtension)),
    );
    const replay = reduceAcpEvents(
      [],
      JSON.parse(JSON.stringify(events)).flatMap((event: AgentSessionEventVO) =>
        translateAcpExtension(event.acpExtension),
      ),
    );
    expect(replay).toEqual(live);
    expect(live).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "resource",
          resource: expect.objectContaining({ id: "report" }),
        }),
      ]),
    );
    expect(JSON.stringify(live)).toContain("max_tokens");
  });

  it("preserves unknown envelopes at rest without coercing them into a known UI event", () => {
    const event = extension({ version: 2, type: "turn_started", turnId: "future", at: "later" });
    const before = structuredClone(event);
    expect(translateAcpExtension(event.acpExtension)).toEqual([]);
    expect(event).toEqual(before);
  });

  it("does not reopen a resolved question when a late replay repeats its request", () => {
    const request = extension({
      type: "input_request",
      requestId: "question",
      message: "Choose",
      requestedSchema: { type: "object", properties: {} },
    });
    expect(pendingInputOf([request], "question")).toMatchObject({ requestId: "question" });
    const resolved = extension(
      { type: "input_resolved", requestId: "question", action: "decline" },
      2,
    );
    expect(pendingInputOf([request, resolved, request], "question")).toBeUndefined();
  });
});

describe("agent answer validation at the server boundary", () => {
  it("accepts SDK titled multi-select items and counts Unicode code points", () => {
    const schema = {
      properties: {
        marker: { type: "string", minLength: 1, maxLength: 1 },
        choices: {
          type: "array",
          items: {
            type: "string",
            anyOf: [
              { const: "first", title: "First option" },
              { const: "second", title: "Second option" },
            ],
          },
        },
      },
      required: ["marker", "choices"],
    };
    expect(() =>
      assertAgentInputResponse(schema, {
        action: "accept",
        content: { marker: "🐱", choices: ["second"] },
      }),
    ).not.toThrow();
    expect(() =>
      assertAgentInputResponse(schema, {
        action: "accept",
        content: { marker: "🐱", choices: ["invented"] },
      }),
    ).toThrow();
  });
  const schema = {
    type: "object",
    properties: {
      strategy: { type: "string", enum: ["careful", "fast"] },
      areas: {
        type: "array",
        items: { type: "string", enum: ["ui", "server"] },
        minItems: 1,
        uniqueItems: true,
      },
      count: { type: "integer", minimum: 1, maximum: 3 },
    },
    required: ["strategy", "areas"],
  };

  it("accepts a valid mixed form and preserves decline/cancel semantics without invented answers", () => {
    expect(() =>
      assertAgentInputResponse(schema, {
        action: "accept",
        content: { strategy: "careful", areas: ["ui", "server"], count: 2 },
      }),
    ).not.toThrow();
    expect(() => assertAgentInputResponse(schema, { action: "decline" })).not.toThrow();
    expect(() => assertAgentInputResponse(schema, { action: "cancel" })).not.toThrow();
  });

  it.each([
    { strategy: "invented", areas: ["ui"] },
    { strategy: "fast", areas: [] },
    { strategy: "fast", areas: ["ui", "ui"] },
    { strategy: "fast", areas: ["ui"], count: 4 },
    { strategy: "fast", areas: ["ui"], injected: true },
    { areas: ["server"] },
  ])("rejects invalid or injected answers %j", (content) => {
    expect(() => assertAgentInputResponse(schema, { action: "accept", content })).toThrow();
  });
});
