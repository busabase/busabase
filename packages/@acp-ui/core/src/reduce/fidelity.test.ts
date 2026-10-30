import { describe, expect, it } from "vitest";
import { parseAcpInputFields, validateAcpInputResponse } from "./input-schema";
import { reduceAcpEvent, reduceAcpEvents } from "./reduce-acp-event";
import type { AcpBlock, AcpLifecycleEvent, AcpUiEvent } from "./types";

const at = "2026-10-26T10:00:00.000Z";
const lifecycle = (
  type: AcpLifecycleEvent["type"],
  values: Partial<AcpLifecycleEvent> = {},
): AcpUiEvent => ({
  type: "lifecycle",
  event: { version: 1, type, turnId: "turn-1", at, ...values },
});
const update = (value: Record<string, unknown>): AcpUiEvent => ({
  type: "session_update",
  update: value as never,
});
const text = (value: string): AcpUiEvent =>
  update({
    sessionUpdate: "agent_message_chunk",
    messageId: "message",
    content: { type: "text", text: value },
  });

describe("complete process fidelity", () => {
  const script: AcpUiEvent[] = [
    lifecycle("turn_started"),
    lifecycle("step_started", { stepId: "step-1", label: "Inspect sources" }),
    update({
      sessionUpdate: "agent_thought_chunk",
      messageId: "message",
      content: { type: "text", text: "Inspecting" },
    }),
    update({
      sessionUpdate: "plan",
      entries: [{ content: "Inspect sources", priority: "high", status: "in_progress" }],
    }),
    update({
      sessionUpdate: "tool_call",
      toolCallId: "read",
      title: "Read project",
      name: "read_file",
      kind: "read",
      status: "pending",
      rawInput: { path: "/agent/project.ts" },
      _meta: { parentToolCallId: "parent" },
    }),
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "read",
      status: "completed",
      locations: [{ path: "/agent/project.ts", line: 3 }],
      content: [{ type: "diff", path: "/agent/project.ts", oldText: "old", newText: "new" }],
      rawOutput: false,
    }),
    lifecycle("step_finished", { stepId: "step-1" }),
    lifecycle("step_started", { stepId: "step-2", label: "Produce answer" }),
    text("Report: "),
    update({
      sessionUpdate: "agent_message_chunk",
      messageId: "message",
      content: {
        type: "resource_link",
        uri: "buda://file/report",
        name: "report.pdf",
        mimeType: "application/pdf",
      },
    }),
    text(" is attached."),
    lifecycle("resource_update", {
      resource: { id: "report", uri: "buda://file/report", name: "report.pdf" },
    }),
    lifecycle("job_update", { job: { id: "job", title: "Generate media", status: "running" } }),
    lifecycle("job_update", {
      job: { id: "job", title: "Generate media", status: "succeeded", resourceIds: ["report"] },
    }),
    lifecycle("turn_finished", {
      at: "2026-10-26T10:00:10.000Z",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    }),
  ];
  it("retains text/resource ordering, complete tool facts and real step boundaries", () => {
    const blocks = reduceAcpEvents([], script);
    expect(blocks.find((block) => block.kind === "tool_call")).toMatchObject({
      id: "read",
      turnId: "turn-1",
      stepId: "step-1",
      name: "read_file",
      status: "completed",
      rawOutput: false,
      locations: [{ path: "/agent/project.ts", line: 3 }],
      _meta: { parentToolCallId: "parent" },
      content: [{ type: "diff", oldText: "old", newText: "new" }],
    });
    const answer = blocks.findLast((block) => block.kind === "message");
    expect(answer).toMatchObject({
      variant: "message",
      text: "Report:  is attached.",
      turnId: "turn-1",
      stepId: "step-2",
    });
    expect(answer?.kind === "message" && answer.content?.map((content) => content.type)).toEqual([
      "text",
      "resource_link",
      "text",
    ]);
    expect(blocks.filter((block) => block.kind === "step")).toHaveLength(2);
    expect(blocks.filter((block) => block.kind === "job")).toEqual([
      {
        kind: "job",
        id: "job",
        turnId: "turn-1",
        job: { id: "job", title: "Generate media", status: "succeeded", resourceIds: ["report"] },
      },
    ]);
    expect(blocks[0]).toMatchObject({
      status: "completed",
      startedAt: at,
      endedAt: "2026-10-26T10:00:10.000Z",
      usage: { totalTokens: 30 },
    });
  });
  it("produces identical display state after serialization and replay", () => {
    const live = script.reduce<AcpBlock[]>((blocks, event) => reduceAcpEvent(blocks, event), []);
    expect(reduceAcpEvents([], JSON.parse(JSON.stringify(script)))).toEqual(live);
  });
  it("does not reopen a finished turn when its start is delivered again", () => {
    const blocks = reduceAcpEvents([], [...script, lifecycle("turn_started")]);
    expect(blocks.filter((block) => block.kind === "turn")).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ status: "completed" });
  });
  it("closes unfinished steps and calls on interruption without declaring them successful", () => {
    const blocks = reduceAcpEvents(
      [],
      [
        lifecycle("turn_started"),
        lifecycle("step_started", { stepId: "step" }),
        update({
          sessionUpdate: "tool_call",
          toolCallId: "work",
          title: "Work",
          status: "in_progress",
        }),
        lifecycle("turn_finished", { stopReason: "cancelled", at: "2026-10-26T10:00:03.000Z" }),
      ],
    );
    expect(blocks.find((block) => block.kind === "tool_call")).toMatchObject({
      status: "failed",
      outcome: "cancelled",
    });
    expect(blocks.find((block) => block.kind === "step")).toMatchObject({
      endedAt: "2026-10-26T10:00:03.000Z",
    });
    expect(blocks[0]).toMatchObject({ status: "cancelled" });
  });
});

describe("v1 complete replacement and patch semantics", () => {
  it("retains tool relationships through transport identity updates and serialized replay", () => {
    const events = [
      update({
        sessionUpdate: "tool_call",
        toolCallId: "child",
        title: "Nested read",
        _meta: {
          "bunny-agent/parentToolCallId": "parent",
          "buda.im": { parentToolCallId: "parent", seq: 1, eventId: "session:1" },
        },
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "child",
        status: "completed",
        _meta: {
          "buda.im": { seq: 2, eventId: "session:2" },
        },
      }),
    ];
    const blocks = reduceAcpEvents([], events);
    expect(blocks[0]).toMatchObject({
      status: "completed",
      parentToolCallId: "parent",
      _meta: {
        "buda.im": { seq: 2, eventId: "session:2" },
      },
    });
    expect(reduceAcpEvents([], JSON.parse(JSON.stringify(events)))).toEqual(blocks);
    expect(
      reduceAcpEvents(blocks, [
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "child",
          _meta: {
            "bunny-agent/parentToolCallId": "other",
            "buda.im": { parentToolCallId: null, seq: 3 },
          },
        }),
      ])[0],
    ).toMatchObject({
      parentToolCallId: "other",
      _meta: {
        "bunny-agent/parentToolCallId": "other",
        "buda.im": { parentToolCallId: null, seq: 3 },
      },
    });
    expect(
      reduceAcpEvents(blocks, [
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "child",
          _meta: { parentToolCallId: null },
        }),
      ])[0],
    ).toMatchObject({ parentToolCallId: null });
  });
  it("replaces the entire plan, including removed entries", () => {
    const blocks = reduceAcpEvents(
      [],
      [
        lifecycle("turn_started"),
        update({
          sessionUpdate: "plan",
          entries: [
            { content: "First", priority: "high", status: "pending" },
            { content: "Removed", priority: "low", status: "pending" },
          ],
        }),
        update({
          sessionUpdate: "plan",
          entries: [{ content: "First", priority: "high", status: "completed" }],
        }),
      ],
    );
    expect(blocks.filter((block) => block.kind === "plan")).toEqual([
      {
        kind: "plan",
        id: "plan:turn-1",
        turnId: "turn-1",
        entries: [{ content: "First", priority: "high", status: "completed" }],
      },
    ]);
  });
  it("preserves optional null fields, replaces content arrays, and replaces v1 metadata whole", () => {
    const blocks = reduceAcpEvents(
      [],
      [
        update({
          sessionUpdate: "tool_call",
          toolCallId: "t",
          title: "Tool",
          status: "completed",
          name: "read",
          rawOutput: 0,
          content: [{ type: "content", content: { type: "text", text: "old" } }],
          _meta: { first: 1, second: 2 },
        }),
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "t",
          name: null,
          rawOutput: null,
          content: [],
          _meta: { second: 3 },
        }),
      ],
    );
    expect(blocks[0]).toMatchObject({
      status: "completed",
      name: "read",
      rawOutput: 0,
      content: [],
      _meta: { second: 3 },
    });
    expect(blocks[0]).not.toMatchObject({ _meta: { first: 1 } });
  });
});

const schema = {
  type: "object",
  required: ["choice", "topics", "count"],
  properties: {
    choice: {
      type: "string",
      title: "Approach",
      oneOf: [
        { const: "safe", title: "Conservative" },
        { const: "fast", title: "Fast" },
      ],
    },
    topics: { type: "array", items: { type: "string", enum: ["ui", "api"] }, minItems: 1 },
    count: { type: "integer", minimum: 1 },
    note: { type: "string" },
  },
};

describe("structured input is distinct from permission", () => {
  const request: AcpUiEvent = {
    type: "input_request",
    requestId: "question",
    message: "Choose an approach",
    requestedSchema: schema,
    toolCallId: "ask",
  };
  it("retains pending input and response/error states across replay without duplicate cards", () => {
    const events: AcpUiEvent[] = [
      request,
      { type: "input_answering", requestId: "question" },
      { type: "input_failed", requestId: "question", error: "Disconnected" },
    ];
    expect(reduceAcpEvents([], events)[0]).toMatchObject({
      kind: "input_request",
      resolution: "pending",
      error: "Disconnected",
    });
    const blocks = reduceAcpEvents(
      [],
      [
        ...events,
        {
          type: "input_resolved",
          requestId: "question",
          action: "accept",
          content: { choice: "safe" },
        },
        request,
        { type: "input_answering", requestId: "question" },
      ],
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      resolution: { action: "accept", content: { choice: "safe" } },
    });
  });
  it("does not reopen a resolved permission when its request is replayed", () => {
    const permission: AcpUiEvent = {
      type: "permission_request",
      requestId: "permission",
      title: "Allow execution?",
      options: [{ optionId: "no", name: "Reject" }],
    };
    expect(
      reduceAcpEvents(
        [],
        [
          permission,
          { type: "permission_resolved", requestId: "permission", optionId: "no" },
          permission,
        ],
      ),
    ).toMatchObject([{ resolution: { optionId: "no" } }]);
  });
  it("validates primitive, enum, multi-select and required answers without coercion", () => {
    expect(parseAcpInputFields(schema)?.[0]?.options?.[0]).toEqual({
      value: "safe",
      label: "Conservative",
    });
    expect(
      validateAcpInputResponse(schema, {
        action: "accept",
        content: { choice: "safe", topics: ["api"], count: 2 },
      }),
    ).toEqual({});
    expect(
      validateAcpInputResponse(schema, {
        action: "accept",
        content: { choice: "invented", topics: [], count: "2" },
      }),
    ).toHaveProperty("choice");
    expect(validateAcpInputResponse(schema, { action: "accept", content: {} })).toHaveProperty(
      "count",
    );
    expect(validateAcpInputResponse(schema, { action: "decline" })).toEqual({});
    expect(
      parseAcpInputFields({ type: "object", properties: { nested: { type: "object" } } }),
    ).toBeNull();
  });
});

describe("late content metadata", () => {
  it("does not lose a metadata-only chunk or collapse it into an earlier unannotated delta", () => {
    const blocks = reduceAcpEvents(
      [],
      [
        text("Exact text"),
        update({
          sessionUpdate: "agent_message_chunk",
          messageId: "message",
          content: { type: "text", text: "" },
          _meta: { citation: { version: 1 } },
        }),
      ],
    );
    expect(blocks[0]).toMatchObject({
      text: "Exact text",
      _meta: { citation: { version: 1 } },
      content: [
        { type: "text", text: "Exact text" },
        { type: "text", text: "", _meta: { citation: { version: 1 } } },
      ],
    });
  });
});

describe("portable form schemas", () => {
  it("accepts the implicit object type and counts string constraints in code points", () => {
    const schema = { properties: { glyph: { type: "string", minLength: 1, maxLength: 1 } } };
    expect(parseAcpInputFields(schema)).not.toBeNull();
    expect(
      validateAcpInputResponse(schema, { action: "accept", content: { glyph: "😀" } }),
    ).toEqual({});
    expect(
      validateAcpInputResponse(schema, { action: "accept", content: { glyph: "😀😀" } }),
    ).toHaveProperty("glyph");
  });
});

describe("terminal user interactions", () => {
  const permission: AcpUiEvent = {
    type: "permission_request",
    requestId: "permission-stop",
    title: "Run work?",
    options: [{ optionId: "yes", name: "Allow" }],
  };
  const question: AcpUiEvent = {
    type: "input_request",
    requestId: "input-stop",
    message: "Choose",
    requestedSchema: { type: "object", properties: {} },
  };
  it("keeps explicit cancellation terminal without changing real selections", () => {
    const blocks = reduceAcpEvents(
      [],
      [
        lifecycle("turn_started"),
        permission,
        question,
        { type: "permission_answering", requestId: "permission-stop" },
        { type: "input_answering", requestId: "input-stop" },
        { type: "permission_cancelled", requestId: "permission-stop" },
        { type: "input_resolved", requestId: "input-stop", action: "cancel" },
        lifecycle("turn_finished", { stopReason: "cancelled" }),
        permission,
        question,
        { type: "permission_resolved", requestId: "permission-stop", optionId: "yes" },
        {
          type: "input_resolved",
          requestId: "input-stop",
          action: "accept",
          content: { stale: true },
        },
      ],
    );
    expect(blocks.find((block) => block.kind === "permission")).toMatchObject({
      resolution: "cancelled",
    });
    expect(blocks.find((block) => block.kind === "input_request")).toMatchObject({
      resolution: { action: "cancel" },
    });
    expect(blocks.filter((block) => block.kind === "permission")).toHaveLength(1);
    const answered = reduceAcpEvents(
      [],
      [
        lifecycle("turn_started"),
        permission,
        { type: "permission_resolved", requestId: "permission-stop", optionId: "yes" },
        lifecycle("turn_finished", { stopReason: "cancelled" }),
      ],
    );
    expect(answered.find((block) => block.kind === "permission")).toMatchObject({
      resolution: { optionId: "yes" },
    });
  });
  it("supports explicit permission cancellation without choosing an option", () => {
    expect(
      reduceAcpEvents(
        [],
        [permission, { type: "permission_cancelled", requestId: "permission-stop" }, permission],
      ),
    ).toMatchObject([{ resolution: "cancelled" }]);
  });
});

describe("decision receipt races", () => {
  it("preserves in-flight delivery across turn end until its receipt arrives", () => {
    const beforeReceipt = reduceAcpEvents(
      [],
      [
        lifecycle("turn_started"),
        {
          type: "permission_request",
          requestId: "p-race",
          title: "Allow?",
          options: [{ optionId: "yes", name: "Allow" }],
        },
        { type: "permission_answering", requestId: "p-race", optionId: "yes" },
        {
          type: "input_request",
          requestId: "i-race",
          message: "Choose",
          requestedSchema: { type: "object", properties: {} },
        },
        {
          type: "input_answering",
          requestId: "i-race",
          response: { action: "accept", content: { answer: "yes" } },
        },
        lifecycle("turn_finished", { stopReason: "end_turn" }),
      ],
    );
    expect(beforeReceipt.find((block) => block.kind === "permission")).toMatchObject({
      resolution: "answering",
      submittedOptionId: "yes",
    });
    expect(beforeReceipt.find((block) => block.kind === "input_request")).toMatchObject({
      resolution: "answering",
      submittedResponse: { action: "accept" },
    });
    const afterReceipt = reduceAcpEvents(beforeReceipt, [
      { type: "permission_resolved", requestId: "p-race", optionId: "yes" },
      { type: "input_resolved", requestId: "i-race", action: "accept", content: { answer: "yes" } },
    ]);
    expect(afterReceipt.find((block) => block.kind === "permission")).toMatchObject({
      resolution: { optionId: "yes" },
    });
    expect(afterReceipt.find((block) => block.kind === "input_request")).toMatchObject({
      resolution: { action: "accept" },
    });
  });
  it("still cancels requests that have not begun delivery when the turn ends", () => {
    const blocks = reduceAcpEvents(
      [],
      [
        lifecycle("turn_started"),
        { type: "permission_request", requestId: "p", title: "Allow?", options: [] },
        {
          type: "input_request",
          requestId: "i",
          message: "Choose",
          requestedSchema: { type: "object", properties: {} },
        },
        lifecycle("turn_finished", { stopReason: "cancelled" }),
      ],
    );
    expect(blocks.find((block) => block.kind === "permission")).toMatchObject({
      resolution: "cancelled",
    });
    expect(blocks.find((block) => block.kind === "input_request")).toMatchObject({
      resolution: { action: "cancel" },
    });
  });
});

describe("host observation interruption", () => {
  const failureAt = "2026-10-27T00:00:04.000Z";
  const partial: AcpUiEvent[] = [
    lifecycle("turn_started", { at: "2026-10-27T00:00:00.000Z" }),
    lifecycle("step_started", { at: "2026-10-27T00:00:01.000Z", stepId: "step-active" }),
    update({
      sessionUpdate: "tool_call",
      toolCallId: "partial-tool",
      title: "Read source",
      status: "in_progress",
      rawInput: { path: "/agent/source.md" },
      content: [{ type: "content", content: { type: "text", text: "Partial output retained." } }],
    }),
  ];
  it("closes the latest running presentation after a host failure and preserves partial data", () => {
    const events: AcpUiEvent[] = [...partial, { type: "interrupted", at: failureAt }];
    const blocks = reduceAcpEvents([], events);
    expect(blocks[0]).toMatchObject({ status: "interrupted", endedAt: failureAt });
    expect(blocks.find((block) => block.kind === "step")).toMatchObject({ endedAt: failureAt });
    expect(blocks.find((block) => block.kind === "tool_call")).toMatchObject({
      status: "failed",
      outcome: "interrupted",
      rawInput: { path: "/agent/source.md" },
      content: [{ type: "content", content: { text: "Partial output retained." } }],
    });
    expect(reduceAcpEvents([], JSON.parse(JSON.stringify(events)))).toEqual(
      events.reduce<AcpBlock[]>((previous, event) => reduceAcpEvent(previous, event), []),
    );
    expect(reduceAcpEvent(blocks, { type: "interrupted", at: "2026-10-27T00:00:08.000Z" })).toBe(
      blocks,
    );
  });
  it("does not rewrite completed turns or in-flight decision receipts", () => {
    const events: AcpUiEvent[] = [
      lifecycle("turn_started", { turnId: "completed" }),
      lifecycle("turn_finished", { turnId: "completed", stopReason: "end_turn" }),
      ...partial,
      {
        type: "input_request",
        requestId: "answer-in-flight",
        message: "Choose",
        requestedSchema: { type: "object", properties: {} },
      },
      {
        type: "input_answering",
        requestId: "answer-in-flight",
        response: { action: "accept", content: { answer: "yes" } },
      },
      { type: "interrupted", at: failureAt },
    ];
    const blocks = reduceAcpEvents([], events);
    expect(blocks.find((block) => block.kind === "turn" && block.id === "completed")).toMatchObject(
      { status: "completed", stopReason: "end_turn" },
    );
    expect(blocks.find((block) => block.kind === "input_request")).toMatchObject({
      resolution: "answering",
      submittedResponse: { action: "accept" },
    });
    const continued = reduceAcpEvent(
      blocks,
      lifecycle("turn_started", { turnId: "continued", at: "2026-10-27T00:00:09.000Z" }),
    );
    expect(continued.at(-1)).toMatchObject({ kind: "turn", id: "continued", status: "running" });
  });
});

describe("SDK titled multi-select alternatives", () => {
  it("supports items.anyOf const/title choices exactly like oneOf choices", () => {
    const schema = {
      properties: {
        topics: {
          type: "array",
          title: "Topics",
          items: {
            anyOf: [
              { const: "ui", title: "User interface" },
              { const: "api", title: "API behavior" },
            ],
          },
        },
      },
      required: ["topics"],
    };
    expect(parseAcpInputFields(schema)?.[0]?.options).toEqual([
      { value: "ui", label: "User interface" },
      { value: "api", label: "API behavior" },
    ]);
    expect(
      validateAcpInputResponse(schema, { action: "accept", content: { topics: ["ui", "api"] } }),
    ).toEqual({});
    expect(
      validateAcpInputResponse(schema, { action: "accept", content: { topics: ["fabricated"] } }),
    ).toHaveProperty("topics");
  });
});
