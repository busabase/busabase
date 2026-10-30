import type { ContentBlock, PromptRequest } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { AcpFixtureStateSchema, AcpPromptRequestSchema } from "./e2e/fixtures/acp-fixture-protocol";

const annotations = {
  audience: ["user", "assistant"] as const,
  lastModified: "2026-10-26T08:00:00Z",
  priority: 0.8,
  _meta: { display: "context" },
};
const contentVariants: ContentBlock[] = [
  { type: "text", text: "user question" },
  { type: "image", mimeType: "image/png", data: "aW1hZ2U=", uri: "image:///source" },
  { type: "audio", mimeType: "audio/wav", data: "YXVkaW8=" },
  { type: "resource_link", uri: "file:///notes.md", name: "notes.md", size: 20 },
  {
    type: "resource",
    resource: { uri: "busabase://spaces/local/nodes/doc", mimeType: "text/markdown", text: "body" },
  },
  {
    type: "resource",
    resource: { uri: "attachment:///data.bin", blob: "AA==", _meta: { encoding: "base64" } },
  },
];
const blocks: ContentBlock[] = contentVariants.map((block) => ({
  ...block,
  annotations: { ...annotations, audience: [...annotations.audience] },
  _meta: { "busabase.node": { id: "node-1", name: "Reference" } },
}));

describe("ACP fixture prompt boundary", () => {
  it("decodes all content variants without dropping annotations or resource metadata", () => {
    const request: PromptRequest = {
      sessionId: "session-1",
      prompt: blocks,
      _meta: { traceId: "prompt-trace" },
    };
    expect(AcpPromptRequestSchema.parse(request)).toEqual(request);
  });

  it.each([
    null,
    {},
    { type: "unknown", text: "unsupported" },
    { type: "text", text: 123 },
    { type: "image", mimeType: "image/png" },
    { type: "audio", data: "AA==", mimeType: null },
    { type: "resource_link", uri: "file:///notes.md" },
    { type: "resource", resource: { uri: "busabase:///node", text: 123 } },
    { type: "resource", resource: { uri: "attachment:///file", blob: false } },
    { type: "text", text: "question", annotations: { audience: ["system"] } },
    { type: "text", text: "question", annotations: { priority: "high" } },
    { type: "text", text: "question", _meta: "invalid metadata" },
  ])("rejects a whole prompt containing malformed content: %j", (invalidBlock) => {
    const parsed = AcpPromptRequestSchema.safeParse({
      sessionId: "session-1",
      prompt: [blocks[0], invalidBlock],
    });
    expect(parsed.success).toBe(false);
  });

  it.each([null, {}, { sessionId: 1, prompt: blocks }, { sessionId: "s", prompt: [] }])(
    "rejects invalid prompt envelopes: %j",
    (request) => {
      expect(AcpPromptRequestSchema.safeParse(request).success).toBe(false);
    },
  );

  it("shares a validated state shape between fixture capture and browser assertions", () => {
    const state = {
      sessions: 1,
      prompts: [{ sessionId: "session-1", prompt: blocks }],
      configurations: [{ id: "session-1", model: "auto", thinkingLevel: null }],
    };
    expect(AcpFixtureStateSchema.parse(state)).toEqual(state);
    expect(
      AcpFixtureStateSchema.safeParse({
        ...state,
        prompts: [{ sessionId: "session-1", prompt: [{ type: "text", text: false }] }],
      }).success,
    ).toBe(false);
  });
});
