import { PromptAgentSessionInputSchema } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import { contextResourceToContentBlock } from "./agent-context-resources";

describe("explicit page context", () => {
  it("allows a reference-only prompt and rejects an entirely empty prompt", () => {
    expect(
      PromptAgentSessionInputSchema.parse({
        sessionId: "session",
        text: "",
        contextReferences: [{ nodeId: "node" }],
      }).contextReferences,
    ).toEqual([{ nodeId: "node" }]);
    expect(
      PromptAgentSessionInputSchema.safeParse({ sessionId: "session", text: " " }).success,
    ).toBe(false);
  });

  it("carries the same text and node identity in both the transcript and ACP resource", () => {
    const block = contextResourceToContentBlock({
      nodeId: "node",
      nodeType: "doc",
      name: "Page",
      slug: "page",
      truncated: false,
      uri: "busabase://spaces/local/nodes/node",
      mimeType: "text/markdown",
      text: "Only the snapshot contains MARKER.",
      annotations: { audience: ["user", "assistant"], lastModified: "2026-10-26T00:00:00.000Z" },
    });
    expect(block).toMatchObject({
      type: "resource",
      resource: { text: "Only the snapshot contains MARKER." },
      annotations: { audience: ["user", "assistant"] },
      _meta: {
        "busabase.node": { id: "node", type: "doc", name: "Page", slug: "page", truncated: false },
      },
    });
  });
});
