import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import { buildAgentTimeline, collapseForPersistence } from "./session-updates";

const at = "2026-08-14T00:00:00.000Z";
let seq = 0;
const update = (acpUpdate: unknown): AgentSessionEventVO => ({
  sessionId: "s1",
  seq: ++seq,
  kind: "acpUpdate",
  acpUpdate,
  at,
});

describe("buildAgentTimeline", () => {
  it("collapses the repeated tool_call/tool_call_update rows one call produces", () => {
    // What a single MCP tool call actually looks like on the wire: one
    // `tool_call` followed by an update per status change, every one carrying
    // the same title.
    const items = buildAgentTimeline([
      update({ sessionUpdate: "tool_call", title: "mcp__busabase__node_create" }),
      update({ sessionUpdate: "tool_call_update", title: "mcp__busabase__node_create" }),
      update({ sessionUpdate: "tool_call_update", title: "mcp__busabase__node_create" }),
    ]);

    expect(items).toEqual([
      { kind: "message", role: "note", text: "Tool: mcp__busabase__node_create" },
    ]);
  });

  it("keeps two different tool calls apart, and does not merge across a reply", () => {
    const items = buildAgentTimeline([
      update({ sessionUpdate: "tool_call", title: "mcp__busabase__auth_verify" }),
      update({ sessionUpdate: "tool_call", title: "mcp__busabase__nodes_list" }),
      update({ sessionUpdate: "agent_message_chunk", content: { text: "Done." } }),
      // The same tool again after the reply is a genuinely new call, not a
      // repeat of the one above it.
      update({ sessionUpdate: "tool_call", title: "mcp__busabase__nodes_list" }),
    ]);

    expect(items.map((i) => (i.kind === "message" ? i.text : "?"))).toEqual([
      "Tool: mcp__busabase__auth_verify",
      "Tool: mcp__busabase__nodes_list",
      "Done.",
      "Tool: mcp__busabase__nodes_list",
    ]);
  });

  it("still merges streamed agent chunks into one bubble", () => {
    const items = buildAgentTimeline([
      update({ sessionUpdate: "agent_message_chunk", content: { text: "CODE" } }),
      update({ sessionUpdate: "agent_message_chunk", content: { text: "X" } }),
      update({ sessionUpdate: "agent_message_chunk", content: { text: "OK" } }),
    ]);

    expect(items).toEqual([{ kind: "message", role: "agent", text: "CODEXOK" }]);
  });

  it("renders Busabase's own session note (e.g. an agent that cannot take HTTP MCP)", () => {
    const items = buildAgentTimeline([
      update({ sessionUpdate: "note", text: "Codex CLI does not support HTTP MCP servers." }),
    ]);

    expect(items).toEqual([
      { kind: "message", role: "note", text: "Codex CLI does not support HTTP MCP servers." },
    ]);
  });

  it("places a permission card in order and carries its resolution", () => {
    const request = {
      requestId: "perm_1",
      title: "mcp__busabase__node_create",
      options: [
        { optionId: "allow", name: "Allow Once" },
        { optionId: "reject", name: "Deny" },
      ],
    };
    const items = buildAgentTimeline([
      update({ sessionUpdate: "agent_message_chunk", content: { text: "Proposing…" } }),
      { sessionId: "s1", seq: ++seq, kind: "permissionRequest", permissionRequest: request, at },
      {
        sessionId: "s1",
        seq: ++seq,
        kind: "permissionResolved",
        permissionRequestId: "perm_1",
        permissionOptionId: "allow",
        at,
      },
    ]);

    expect(items[1]).toEqual({ kind: "permission", request, resolvedOptionId: "allow" });
  });
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
