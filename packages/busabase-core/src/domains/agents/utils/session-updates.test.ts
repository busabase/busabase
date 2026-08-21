import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import { collapseForPersistence } from "./session-updates";

const at = "2026-08-14T00:00:00.000Z";
let seq = 0;
const update = (acpUpdate: unknown): AgentSessionEventVO => ({
  sessionId: "s1",
  seq: ++seq,
  kind: "acpUpdate",
  acpUpdate,
  at,
});

describe("collapseForPersistence", () => {
  it("merges a streamed reply into one row, keeping the FIRST chunk's seq", () => {
    // Replay is `seq > afterSeq`; if the merged row took the LAST chunk's seq,
    // a client that had already seen "CODE" would be handed "CODEXOK" again.
    const events = [
      update({ sessionUpdate: "agent_message_chunk", content: { text: "CODE" } }),
      update({ sessionUpdate: "agent_message_chunk", content: { text: "X" } }),
      update({ sessionUpdate: "agent_message_chunk", content: { text: "OK" } }),
    ];
    const firstSeq = events[0]?.seq;

    const collapsed = collapseForPersistence(events);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.seq).toBe(firstSeq);
    expect((collapsed[0]?.acpUpdate as { content: { text: string } }).content.text).toBe("CODEXOK");
  });

  it("does not mutate the live buffer it was handed", () => {
    // The same event objects are still being streamed to subscribers, so
    // appending to `content.text` in place would corrupt the live transcript.
    const events = [
      update({ sessionUpdate: "agent_message_chunk", content: { text: "a" } }),
      update({ sessionUpdate: "agent_message_chunk", content: { text: "b" } }),
    ];

    collapseForPersistence(events);

    expect((events[0]?.acpUpdate as { content: { text: string } }).content.text).toBe("a");
  });

  it("keeps non-chunk events whole and does not merge across them", () => {
    const collapsed = collapseForPersistence([
      update({ sessionUpdate: "agent_message_chunk", content: { text: "one" } }),
      update({ sessionUpdate: "tool_call", title: "mcp__busabase__nodes_list" }),
      update({ sessionUpdate: "agent_message_chunk", content: { text: "two" } }),
    ]);

    expect(collapsed).toHaveLength(3);
  });

  it("passes permission events through untouched — they are the audit trail", () => {
    const request = { requestId: "perm_1", options: [{ optionId: "allow", name: "Allow" }] };
    const events: AgentSessionEventVO[] = [
      { sessionId: "s1", seq: 1, kind: "permissionRequest", permissionRequest: request, at },
      {
        sessionId: "s1",
        seq: 2,
        kind: "permissionResolved",
        permissionRequestId: "perm_1",
        permissionOptionId: "allow",
        at,
      },
    ];

    expect(collapseForPersistence(events)).toEqual(events);
  });
});
