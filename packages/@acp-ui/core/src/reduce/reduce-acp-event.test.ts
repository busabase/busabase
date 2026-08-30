import { describe, expect, it } from "vitest";
import { reduceAcpEvent, reduceAcpEvents } from "./reduce-acp-event";
import type { AcpBlock, AcpMessageBlock, AcpUiEvent } from "./types";

const text = (t: string) => ({ type: "text" as const, text: t });
const image = (data = "base64…", mimeType = "image/png") => ({
  type: "image" as const,
  data,
  mimeType,
});

const agentChunk = (t: string, messageId?: string): AcpUiEvent => ({
  type: "session_update",
  update: {
    sessionUpdate: "agent_message_chunk",
    content: text(t),
    ...(messageId ? { messageId } : {}),
  } as never,
});

const agentImageChunk = (data?: string, mimeType?: string, messageId?: string): AcpUiEvent => ({
  type: "session_update",
  update: {
    sessionUpdate: "agent_message_chunk",
    content: image(data, mimeType),
    ...(messageId ? { messageId } : {}),
  } as never,
});

const thoughtChunk = (t: string): AcpUiEvent => ({
  type: "session_update",
  update: { sessionUpdate: "agent_thought_chunk", content: text(t) } as never,
});

const userChunk = (t: string): AcpUiEvent => ({
  type: "session_update",
  update: { sessionUpdate: "user_message_chunk", content: text(t) } as never,
});

const toolCall = (toolCallId: string, fields: Record<string, unknown> = {}): AcpUiEvent => ({
  type: "session_update",
  update: { sessionUpdate: "tool_call", toolCallId, title: "Read file", ...fields } as never,
});

const toolCallUpdate = (toolCallId: string, fields: Record<string, unknown> = {}): AcpUiEvent => ({
  type: "session_update",
  update: { sessionUpdate: "tool_call_update", toolCallId, ...fields } as never,
});

const fold = (events: AcpUiEvent[]): AcpBlock[] => reduceAcpEvents([], events);

describe("message chunks", () => {
  it("merges consecutive agent chunks into one block", () => {
    const blocks = fold([agentChunk("Hello"), agentChunk(" world")]);
    expect(blocks).toEqual([
      {
        kind: "message",
        id: "agent-message-0",
        role: "agent",
        variant: "message",
        text: "Hello world",
      },
    ]);
  });

  it("keeps thoughts separate from replies", () => {
    const blocks = fold([thoughtChunk("thinking…"), agentChunk("Here you go")]);
    expect(blocks.map((b) => b.kind === "message" && b.variant)).toEqual(["thought", "message"]);
    expect(blocks).toHaveLength(2);
  });

  it("does not merge across roles", () => {
    const blocks = fold([userChunk("hi"), agentChunk("hello")]);
    expect(blocks).toHaveLength(2);
  });

  it("ignores content this core has no representation for (resource_link) rather than emitting an empty bubble", () => {
    const blocks = fold([
      {
        type: "session_update",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "resource_link", uri: "file:///README.md", name: "README.md" },
        } as never,
      },
    ]);
    expect(blocks).toEqual([]);
  });

  describe("messageId is authoritative when present", () => {
    it("merges chunks sharing a messageId", () => {
      const blocks = fold([agentChunk("a", "m1"), agentChunk("b", "m1")]);
      expect(blocks).toHaveLength(1);
      expect((blocks[0] as { text: string }).text).toBe("ab");
    });

    it("starts a new block when the messageId changes, even mid-role", () => {
      const blocks = fold([agentChunk("first", "m1"), agentChunk("second", "m2")]);
      expect(blocks).toHaveLength(2);
      expect(blocks.map((b) => (b as { text: string }).text)).toEqual(["first", "second"]);
    });

    it("does not merge an id-less chunk into an id-bearing block", () => {
      const blocks = fold([agentChunk("with id", "m1"), agentChunk("without")]);
      expect(blocks).toHaveLength(2);
    });
  });
});

describe("attachments", () => {
  it("keeps an image content block instead of dropping it", () => {
    const blocks = fold([agentImageChunk("abc123", "image/jpeg")]);
    expect(blocks).toEqual([
      {
        kind: "message",
        id: "agent-message-0",
        role: "agent",
        variant: "message",
        text: "",
        attachments: [{ kind: "image", data: "abc123", mimeType: "image/jpeg" }],
      },
    ]);
  });

  it("appends the attachment to the same block when text precedes it", () => {
    const blocks = fold([agentChunk("here's a screenshot: "), agentImageChunk()]);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as AcpMessageBlock;
    expect(block.text).toBe("here's a screenshot: ");
    expect(block.attachments).toHaveLength(1);
  });

  it("collects multiple attachments on one message, in arrival order", () => {
    const blocks = fold([
      agentImageChunk("first", "image/png"),
      agentImageChunk("second", "image/jpeg"),
    ]);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as AcpMessageBlock;
    expect(block.attachments?.map((a) => a.data)).toEqual(["first", "second"]);
  });

  it("does not merge an attachment into a block of a different role or variant", () => {
    const blocks = fold([thoughtChunk("thinking"), agentImageChunk()]);
    expect(blocks).toHaveLength(2);
    expect((blocks[1] as AcpMessageBlock).variant).toBe("message");
  });

  // Same audio content shape as image (base64 `data` + `mimeType`); one test
  // is enough to pin that `attachmentOf` handles both, not two full copies of
  // the suite above.
  it("keeps audio content the same way as image content", () => {
    const blocks = fold([
      {
        type: "session_update",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "audio", data: "clip", mimeType: "audio/wav" },
        } as never,
      },
    ]);
    expect((blocks[0] as AcpMessageBlock).attachments).toEqual([
      { kind: "audio", data: "clip", mimeType: "audio/wav" },
    ]);
  });

  // An embedded `resource` is what the user's own file attachments echo back
  // as, and what an agent forwarding MCP tool output can send. Both arms of
  // `EmbeddedResourceResource` normalise to the same base64 `data` shape so
  // the renderers never branch on which one arrived.
  const resourceChunk = (resource: unknown): AcpUiEvent => ({
    type: "session_update",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "resource", resource },
    } as never,
  });

  it("normalises a text resource to base64, recovering the filename from its uri", () => {
    const blocks = fold([
      resourceChunk({
        uri: "attachment:///my%20notes.md",
        mimeType: "text/markdown",
        text: "# hi",
      }),
    ]);
    expect((blocks[0] as AcpMessageBlock).attachments).toEqual([
      {
        kind: "file",
        data: Buffer.from("# hi", "utf8").toString("base64"),
        mimeType: "text/markdown",
        filename: "my notes.md",
      },
    ]);
  });

  it("passes a blob resource through untouched", () => {
    const blocks = fold([
      resourceChunk({
        uri: "file:///tmp/report.pdf",
        mimeType: "application/pdf",
        blob: "JVBERi0=",
      }),
    ]);
    expect((blocks[0] as AcpMessageBlock).attachments).toEqual([
      { kind: "file", data: "JVBERi0=", mimeType: "application/pdf", filename: "report.pdf" },
    ]);
  });

  it("defaults a resource with no declared mime type rather than dropping it", () => {
    const blocks = fold([resourceChunk({ uri: "attachment:///x", text: "plain" })]);
    expect((blocks[0] as AcpMessageBlock).attachments?.[0]?.mimeType).toBe(
      "application/octet-stream",
    );
  });

  it("still ignores resource_link, which names a file rather than carrying one", () => {
    const blocks = fold([
      {
        type: "session_update",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "resource_link", uri: "file:///a.ts", name: "a.ts" },
        } as never,
      },
    ]);
    expect(blocks).toEqual([]);
  });
});

describe("tool calls", () => {
  it("keeps the real status instead of flattening to text", () => {
    const blocks = fold([toolCall("t1", { kind: "read", status: "in_progress" })]);
    expect(blocks).toEqual([
      { kind: "tool_call", id: "t1", title: "Read file", toolKind: "read", status: "in_progress" },
    ]);
  });

  it("defaults a status-less call to pending", () => {
    expect((fold([toolCall("t1")])[0] as { status: string }).status).toBe("pending");
  });

  // The bug busabase's flat text model had: ACP emits one `tool_call` plus a
  // `tool_call_update` per status change, all with the same title, so a single
  // call rendered as up to six identical rows. Keying on toolCallId removes the
  // problem structurally rather than needing a text-dedupe workaround.
  it("collapses a call plus its updates into ONE block", () => {
    const blocks = fold([
      toolCall("t1", { status: "pending" }),
      toolCallUpdate("t1", { status: "in_progress" }),
      toolCallUpdate("t1", { status: "completed" }),
    ]);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { status: string }).status).toBe("completed");
  });

  it("lets an update supply a title the initial call omitted", () => {
    const blocks = fold([
      toolCall("t1", { title: "" }),
      toolCallUpdate("t1", { title: "Ran tests" }),
    ]);
    expect((blocks[0] as { title: string }).title).toBe("Ran tests");
  });

  it("does not let a partial update erase fields it omits", () => {
    const blocks = fold([
      toolCall("t1", { title: "Read file", kind: "read", status: "pending" }),
      toolCallUpdate("t1", { status: "completed" }),
    ]);
    expect(blocks[0]).toEqual({
      kind: "tool_call",
      id: "t1",
      title: "Read file",
      toolKind: "read",
      status: "completed",
    });
  });

  it("renders an update for a call it never saw created (joined mid-turn)", () => {
    const blocks = fold([toolCallUpdate("t9", { status: "completed" })]);
    expect(blocks).toEqual([
      { kind: "tool_call", id: "t9", title: "t9", toolKind: null, status: "completed" },
    ]);
  });

  it("keeps two distinct calls apart", () => {
    const blocks = fold([toolCall("t1"), toolCall("t2")]);
    expect(blocks).toHaveLength(2);
  });
});

describe("permissions", () => {
  const request: AcpUiEvent = {
    type: "permission_request",
    requestId: "p1",
    title: "Run `rm -rf build`?",
    options: [
      { optionId: "once", name: "Allow once", kind: "allow_once" },
      { optionId: "always", name: "Always allow", kind: "allow_always" },
      { optionId: "no", name: "Reject", kind: "reject_once" },
    ],
  };

  // The reason this view model is not UIMessage: the AI SDK's approval state is
  // a boolean, which cannot carry "allow once" vs "always allow" vs "reject".
  it("preserves every option rather than collapsing to approve/deny", () => {
    const blocks = fold([request]);
    expect((blocks[0] as { options: unknown[] }).options).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ kind: "permission", resolution: "pending" });
  });

  it("has no timeout unless one is given — busabase waits indefinitely", () => {
    expect(fold([request])[0]).not.toHaveProperty("timeoutAt");
  });

  it("carries a timeout when the host sets one — acprouter counts down 5 minutes", () => {
    const blocks = fold([{ ...request, timeoutAt: "2026-08-19T10:00:00Z" } as AcpUiEvent]);
    expect(blocks[0]).toMatchObject({ timeoutAt: "2026-08-19T10:00:00Z" });
  });

  it("moves pending → answering → resolved", () => {
    const answering = fold([request, { type: "permission_answering", requestId: "p1" }]);
    expect(answering[0]).toMatchObject({ resolution: "answering" });

    const resolved = reduceAcpEvent(answering, {
      type: "permission_resolved",
      requestId: "p1",
      optionId: "once",
    });
    expect(resolved[0]).toMatchObject({ resolution: { optionId: "once" } });
  });

  // Resolution must win from either state: acprouter optimistically flips to
  // "answering" the instant the user clicks, so the real resolved event that
  // arrives moments later would be dropped if it only matched "pending".
  it("resolves directly from pending, without an answering step", () => {
    const blocks = fold([
      request,
      { type: "permission_resolved", requestId: "p1", optionId: "always" },
    ]);
    expect(blocks[0]).toMatchObject({ resolution: { optionId: "always" } });
  });

  it("does not reopen an already-resolved request if a late click arrives", () => {
    const blocks = fold([
      request,
      { type: "permission_resolved", requestId: "p1", optionId: "no" },
      { type: "permission_answering", requestId: "p1" },
    ]);
    expect(blocks[0]).toMatchObject({ resolution: { optionId: "no" } });
  });

  it("ignores a resolution for an unknown request", () => {
    const blocks = fold([
      request,
      { type: "permission_resolved", requestId: "nope", optionId: "x" },
    ]);
    expect(blocks[0]).toMatchObject({ resolution: "pending" });
  });

  it("resolves the right one when two are outstanding", () => {
    const second: AcpUiEvent = { ...request, requestId: "p2" } as AcpUiEvent;
    const blocks = fold([
      request,
      second,
      { type: "permission_resolved", requestId: "p2", optionId: "once" },
    ]);
    expect(blocks[0]).toMatchObject({ id: "p1", resolution: "pending" });
    expect(blocks[1]).toMatchObject({ id: "p2", resolution: { optionId: "once" } });
  });
});

describe("notes", () => {
  it("appends a session-level note", () => {
    expect(fold([{ type: "note", text: "Agent has no workspace access." }])).toEqual([
      { kind: "note", id: "note-0", text: "Agent has no workspace access." },
    ]);
  });

  it("marks a terminal note as ended", () => {
    expect(fold([{ type: "note", text: "Session ended — timeout", ended: true }])[0]).toMatchObject(
      {
        ended: true,
      },
    );
  });
});

// These are real ACP v1 kinds that neither implementation this replaces rendered.
// Pinned so that adding a renderer later is a deliberate decision rather than an
// accidental behaviour change — and so they never leak as unreadable JSON.
describe("unhandled ACP update kinds are ignored, not leaked", () => {
  it.each([
    "plan",
    "plan_update",
    "plan_removed",
    "available_commands_update",
    "current_mode_update",
    "config_option_update",
    "session_info_update",
    "usage_update",
  ])("%s produces no block", (sessionUpdate) => {
    expect(fold([{ type: "session_update", update: { sessionUpdate } as never }])).toEqual([]);
  });
});

// The central design claim: acprouter streams events live, busabase folds a
// persisted array. If these ever diverge, replaying a stored session would
// render differently from having watched it happen.
describe("live feeding and replay folding agree", () => {
  const script: AcpUiEvent[] = [
    userChunk("summarise the repo"),
    thoughtChunk("Let me look around"),
    toolCall("t1", { title: "List files", kind: "read", status: "pending" }),
    toolCallUpdate("t1", { status: "completed" }),
    agentChunk("I found "),
    agentChunk("three packages."),
    {
      type: "permission_request",
      requestId: "p1",
      title: "Delete build/?",
      options: [{ optionId: "yes", name: "Allow" }],
    },
    { type: "permission_answering", requestId: "p1" },
    { type: "permission_resolved", requestId: "p1", optionId: "yes" },
    { type: "note", text: "Session ended", ended: true },
  ];

  it("produces identical output either way", () => {
    const live = script.reduce<AcpBlock[]>((acc, e) => reduceAcpEvent(acc, e), []);
    const replayed = reduceAcpEvents([], script);
    expect(replayed).toEqual(live);
  });

  it("produces the expected transcript", () => {
    expect(reduceAcpEvents([], script).map((b) => b.kind)).toEqual([
      "message",
      "message",
      "tool_call",
      "message",
      "permission",
      "note",
    ]);
  });

  it("never mutates the input array", () => {
    const before: AcpBlock[] = [];
    reduceAcpEvents(before, script);
    expect(before).toEqual([]);
  });
});
