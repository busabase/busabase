import { availableCommandsOf, reduceAcpEvents } from "@acp-ui/core/reduce";
import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import { translateAgentSessionEvent } from "../hooks/use-agent-session";

const userMessage = (
  seq: number,
  text: string,
  attachments?: Array<Record<string, unknown>>,
): AgentSessionEventVO => ({
  sessionId: "session-1",
  seq,
  kind: "acpUpdate",
  acpUpdate: {
    sessionUpdate: "user_message",
    text,
    ...(attachments ? { attachments } : {}),
  },
  at: "2026-09-23T00:00:00.000Z",
});

describe("translateAgentSessionEvent user messages", () => {
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
