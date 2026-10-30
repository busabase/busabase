import { availableCommandsOf, reduceAcpEvents } from "@acp-ui/core/reduce";
import {
  createAgentPromptEnvelope,
  createPromptResourceContext,
} from "busabase-contract/domains/agents/prompt-context";
import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import { translateAgentSessionEvent } from "../hooks/use-agent-session";

const userMessage = (
  seq: number,
  text: string,
  attachments?: Array<Record<string, unknown>>,
  presentation?: unknown,
): AgentSessionEventVO => ({
  sessionId: "session-1",
  seq,
  kind: "acpUpdate",
  acpUpdate: {
    sessionUpdate: "user_message",
    text,
    ...(attachments ? { attachments } : {}),
    ...(presentation !== undefined ? { presentation } : {}),
  },
  at: "2026-09-23T00:00:00.000Z",
});

describe("translateAgentSessionEvent user messages", () => {
  it("replays complete semantic prompt snapshots without expanding or duplicating the user text", () => {
    const context = createPromptResourceContext(
      createAgentPromptEnvelope({
        scenario: { id: "find", title: "Find records" },
        target: { nodeId: "nod_target", nodeName: "目标", nodeType: "base" },
        source: { origin: "https://busa.test", edition: "desktop" },
        segments: [
          { kind: "target", text: "Target: 目标" },
          { kind: "task", text: "Full immutable text\n " },
        ],
      }),
      "copy-1",
    );
    const event = userMessage(1, "Only the latest records");
    event.acpUpdate = {
      ...(event.acpUpdate as Record<string, unknown>),
      resourceContext: [context],
    };
    const live = reduceAcpEvents([], translateAgentSessionEvent(event));
    const replay = reduceAcpEvents(
      [],
      translateAgentSessionEvent(JSON.parse(JSON.stringify(event))),
    );
    expect(replay).toEqual(live);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({
      role: "user",
      text: "Only the latest records",
      attachments: [
        {
          resource: {
            resource: { uri: context.uri, mimeType: "text/plain", text: context.text },
            _meta: {
              "acp-ui.resourceContext": { id: context.id, name: context.name },
            },
          },
        },
      ],
    });
  });
  it("closes a partial source presentation when the host durably reports failure", () => {
    const initial = reduceAcpEvents(
      [],
      [
        {
          type: "lifecycle",
          event: {
            version: 1,
            type: "turn_started",
            turnId: "source-turn",
            at: "2026-10-26T00:00:00Z",
          },
        },
        {
          type: "session_update",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call",
            title: "Read",
            status: "in_progress",
          },
        },
      ],
    );
    const event: AgentSessionEventVO = {
      sessionId: "session-1",
      seq: 12,
      kind: "status",
      status: "failed",
      at: "2026-10-26T00:01:00Z",
    };
    const live = reduceAcpEvents(initial, translateAgentSessionEvent(event));
    expect(live).toMatchObject([
      { kind: "turn", status: "interrupted" },
      { kind: "tool_call", status: "failed", outcome: "interrupted" },
    ]);
    expect(
      reduceAcpEvents(initial, translateAgentSessionEvent(JSON.parse(JSON.stringify(event)))),
    ).toEqual(live);
  });
  it("shows explicitly recorded user text identically live and after JSON replay", () => {
    const typedText = "Target: I wrote this myself.\n\n这个不做。";
    const event = userMessage(1, `Official context in any language\n\n${typedText}`, undefined, {
      version: 1,
      source: "node-context",
      text: typedText,
    });
    const live = reduceAcpEvents([], translateAgentSessionEvent(event));
    const replay = reduceAcpEvents(
      [],
      translateAgentSessionEvent(JSON.parse(JSON.stringify(event))),
    );

    expect(live).toMatchObject([{ kind: "message", role: "user", text: typedText }]);
    expect(replay).toEqual(live);
    expect((event.acpUpdate as { text: string }).text).toContain("Official context");
  });

  it("preserves empty visible text and the attachment instead of revealing automatic context", () => {
    const event = userMessage(
      2,
      "Official context",
      [{ kind: "image", data: "QUJD", mimeType: "image/png" }],
      { version: 1, source: "node-context", text: "" },
    );

    expect(reduceAcpEvents([], translateAgentSessionEvent(event))).toMatchObject([
      { kind: "message", role: "user", text: "", attachments: [{ kind: "image" }] },
    ]);
  });

  it.each([
    undefined,
    null,
    {},
    { text: "hide this" },
    { version: 2, source: "node-context", text: "hide this" },
    { version: 1, source: "unknown", text: "hide this" },
    { version: 1, source: "node-context", text: null },
  ])(
    "keeps the complete original message for legacy or unsupported metadata %j",
    (presentation) => {
      const original =
        'Target: the Busabase Base "My pasted example" (nodeId: nod_example).\n\nKeep all of this.';
      const event = userMessage(3, original, undefined, presentation);
      expect(reduceAcpEvents([], translateAgentSessionEvent(event))).toMatchObject([
        { text: original },
      ]);
    },
  );

  it("replays the persisted node snapshot in the same message without changing user text", () => {
    const contextResource = {
      nodeId: "node-1",
      nodeType: "doc",
      name: "Original name",
      slug: "original",
      truncated: false,
      uri: "busabase://spaces/local/nodes/node-1",
      mimeType: "text/markdown",
      text: "Snapshot marker: BODY_ONLY_123",
      annotations: { audience: ["user", "assistant"] },
    };
    const event = userMessage(4, "read the reference");
    event.acpUpdate = {
      ...(event.acpUpdate as Record<string, unknown>),
      contextResources: [contextResource],
    };
    const translated = translateAgentSessionEvent(event);
    const blocks = reduceAcpEvents([], translated);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      role: "user",
      text: "read the reference",
      attachments: [
        {
          resource: {
            type: "resource",
            resource: { uri: contextResource.uri, text: contextResource.text },
            annotations: contextResource.annotations,
            _meta: { "busabase.node": { id: "node-1", name: "Original name" } },
          },
        },
      ],
    });
    expect(reduceAcpEvents([], translateAgentSessionEvent(structuredClone(event)))).toEqual(blocks);
  });

  it("replays a reference-only message without inventing user text", () => {
    const event = userMessage(5, "");
    event.acpUpdate = {
      ...(event.acpUpdate as Record<string, unknown>),
      contextResources: [
        {
          nodeId: "context-only",
          nodeType: "doc",
          name: "Only reference",
          slug: "only-reference",
          truncated: false,
          uri: "busabase://spaces/local/nodes/context-only",
          mimeType: "text/markdown",
          text: "Reference without a caption",
          annotations: { audience: ["user", "assistant"] },
        },
      ],
    };
    expect(reduceAcpEvents([], translateAgentSessionEvent(event))).toMatchObject([
      {
        role: "user",
        text: "",
        attachments: [{ resource: { resource: { text: "Reference without a caption" } } }],
      },
    ]);
  });

  it("ignores malformed historical resource data", () => {
    const event = userMessage(5, "");
    event.acpUpdate = {
      ...(event.acpUpdate as Record<string, unknown>),
      contextResources: [{ nodeId: "malformed" }],
    };
    expect(() => reduceAcpEvents([], translateAgentSessionEvent(event))).not.toThrow();
  });
  it("keeps a follow-up separate when a cancelled turn produced no agent message", () => {
    const events = [
      ...translateAgentSessionEvent(userMessage(1, "hi")),
      ...translateAgentSessionEvent(userMessage(2, "Tell me about")),
    ];

    const blocks = reduceAcpEvents([], events);

    expect(blocks).toMatchObject([
      { kind: "message", role: "user", text: "hi" },
      { kind: "message", role: "user", text: "Tell me about" },
    ]);
  });

  it("keeps one event's text and attachments in the same message", () => {
    const events = translateAgentSessionEvent(
      userMessage(3, "inspect this", [
        { kind: "image", data: "QUJD", mimeType: "image/png" },
        {
          kind: "file",
          data: "REVG",
          mimeType: "text/plain",
          filename: "notes.txt",
        },
      ]),
    );

    const blocks = reduceAcpEvents([], events);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "message",
      role: "user",
      text: "inspect this",
      attachments: [
        { kind: "image", data: "QUJD", mimeType: "image/png" },
        {
          kind: "file",
          data: "REVG",
          mimeType: "text/plain",
          filename: "notes.txt",
        },
      ],
    });
  });
});

describe("translateAgentSessionEvent available commands", () => {
  it("preserves each dynamic full-list replacement from the agent", () => {
    const event = (seq: number, availableCommands: Array<Record<string, unknown>>) =>
      ({
        sessionId: "session-1",
        seq,
        kind: "acpUpdate",
        acpUpdate: { sessionUpdate: "available_commands_update", availableCommands },
        at: "2026-09-28T00:00:00.000Z",
      }) satisfies AgentSessionEventVO;

    const initial = translateAgentSessionEvent(
      event(1, [
        { name: "status", description: "Display session configuration and token usage." },
        { name: "review", description: "Review changes.", input: { hint: "instructions" } },
      ]),
    );
    const replacement = translateAgentSessionEvent(
      event(2, [{ name: "status", description: "Display current status." }]),
    );

    expect(initial).toHaveLength(1);
    expect(availableCommandsOf(initial[0])).toEqual([
      { name: "status", description: "Display session configuration and token usage." },
      { name: "review", description: "Review changes.", input: { hint: "instructions" } },
    ]);
    expect(availableCommandsOf(replacement[0])).toEqual([
      { name: "status", description: "Display current status." },
    ]);
  });
});
