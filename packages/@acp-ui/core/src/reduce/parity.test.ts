import { describe, expect, it } from "vitest";
import { reduceAcpEvents } from "./reduce-acp-event";
import type { AcpUiEvent } from "./types";

/**
 * Parity against the implementations this replaced.
 *
 * The expectation below was not hand-written: it is the output of acprouter's
 * own `applyEvent` reducer, transcribed verbatim while that reducer still
 * existed, run over the same script. acprouter was the higher-fidelity of the
 * two, so matching it was the bar for "equivalent replacement".
 *
 * Both original reducers have since been deleted — acprouter's
 * `use-agent-session.ts` is now a transport adapter over this one, and
 * busabase's `buildAgentTimeline` is gone. So this is now a *golden* rather
 * than a live cross-check: it preserves what the replaced behaviour was, which
 * is exactly what a reader six months from now cannot reconstruct from the
 * tree. Do not "update" it to match a change in this reducer — a diff here
 * means the shared core drifted from the behaviour two shipped apps had.
 *
 * busabase deliberately did NOT match: it merged thoughts into ordinary
 * messages and flattened tool status to a text line. The last assertion pins
 * the two places this core intentionally beats it.
 */
const script: AcpUiEvent[] = [
  {
    type: "session_update",
    update: {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking" },
    } as never,
  },
  {
    type: "session_update",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello " },
    } as never,
  },
  {
    type: "session_update",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "world" },
    } as never,
  },
  {
    type: "session_update",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Read",
      kind: "read",
      status: "pending",
    } as never,
  },
  {
    type: "session_update",
    update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" } as never,
  },
];

describe("parity with acprouter's existing reducer", () => {
  it("produces the same transcript shape", () => {
    const blocks = reduceAcpEvents([], script);

    expect(
      blocks.map((b) => ({
        kind: b.kind,
        ...(b.kind === "message" ? { variant: b.variant, text: b.text } : {}),
        ...(b.kind === "tool_call" ? { status: b.status } : {}),
      })),
    ).toEqual([
      { kind: "message", variant: "thought", text: "thinking" },
      { kind: "message", variant: "message", text: "Hello world" },
      { kind: "tool_call", status: "completed" },
    ]);
  });

  it("keeps the two things busabase's implementation loses", () => {
    const blocks = reduceAcpEvents([], script);

    // 1. thought stays distinguishable from the reply (busabase merges both into one role)
    const messages = blocks.filter((b) => b.kind === "message");
    expect(messages.map((b) => b.kind === "message" && b.variant)).toEqual(["thought", "message"]);

    // 2. tool status survives (busabase flattens to a `Tool: {title}` text line)
    const tool = blocks.find((b) => b.kind === "tool_call");
    expect(tool).toMatchObject({ status: "completed", toolKind: "read" });
  });
});
