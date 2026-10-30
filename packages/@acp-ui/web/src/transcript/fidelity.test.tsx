import {
  type AcpBlock,
  type AcpInputBlock,
  type AcpUiEvent,
  reduceAcpEvents,
} from "@acp-ui/core/reduce";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AcpTranscript } from "./acp-transcript";
import { AcpInputView } from "./input-view";
import { AcpResourceView, safeResourceUrl } from "./resource-view";

const noop = () => undefined;
const at = "2026-10-26T10:00:00.000Z";
const update = (payload: Record<string, unknown>): AcpUiEvent => ({
  type: "session_update",
  update: payload as never,
});
const running: AcpUiEvent[] = [
  { type: "lifecycle", event: { version: 1, type: "turn_started", turnId: "turn", at } },
  {
    type: "lifecycle",
    event: {
      version: 1,
      type: "step_started",
      turnId: "turn",
      stepId: "step",
      at,
      label: "Inspect project",
    },
  },
  update({
    sessionUpdate: "plan",
    entries: [
      { content: "Read project", status: "completed", priority: "high" },
      { content: "Write answer", status: "in_progress", priority: "medium" },
    ],
  }),
  update({
    sessionUpdate: "tool_call",
    toolCallId: "tool",
    title: "Inspect package",
    kind: "read",
    status: "completed",
    rawOutput: "package contents",
  }),
  update({
    sessionUpdate: "agent_message_chunk",
    messageId: "answer",
    content: { type: "text", text: "The project is ready." },
  }),
];

describe("process timeline", () => {
  it("opens live process, collapses it on completion and keeps the answer visible", async () => {
    const { rerender } = render(
      <AcpTranscript blocks={reduceAcpEvents([], running)} onAnswerPermission={noop} />,
    );
    expect(screen.getByTestId("acp-process-content")).toBeVisible();
    expect(screen.getByTestId("acp-step")).toHaveTextContent("Inspect project");
    expect(screen.getByTestId("acp-plan")).toHaveTextContent("1 of 2 completed");
    const completed: AcpUiEvent = {
      type: "lifecycle",
      event: {
        version: 1,
        type: "turn_finished",
        turnId: "turn",
        at: "2026-10-26T10:00:10.000Z",
        stopReason: "end_turn",
      },
    };
    rerender(
      <AcpTranscript
        blocks={reduceAcpEvents([], [...running, completed])}
        onAnswerPermission={noop}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId("acp-process-content")).not.toBeVisible());
    expect(screen.getByTestId("acp-process-summary")).toHaveTextContent("Worked for 10s");
    expect(screen.getByText("The project is ready.")).toBeVisible();
    await userEvent.click(screen.getByTestId("acp-process-summary"));
    expect(screen.getByTestId("acp-process-content")).toBeVisible();
    expect(screen.getByText("Inspect package")).toBeVisible();
  });
  it("shows a cancelled turn and a stopped tool instead of a running spinner", async () => {
    const events: AcpUiEvent[] = [
      running[0],
      update({
        sessionUpdate: "tool_call",
        toolCallId: "work",
        title: "Long work",
        status: "in_progress",
      }),
      {
        type: "lifecycle",
        event: { version: 1, type: "turn_finished", turnId: "turn", at, stopReason: "cancelled" },
      },
    ];
    render(<AcpTranscript blocks={reduceAcpEvents([], events)} onAnswerPermission={noop} />);
    expect(screen.getByTestId("acp-process-summary")).toHaveTextContent("Stopped");
    await userEvent.click(screen.getByTestId("acp-process-summary"));
    expect(screen.getByTestId("acp-tool-call")).toHaveTextContent("Stopped");
  });
  it("renders structured tool content, locations and replacement plans", async () => {
    const blocks = reduceAcpEvents(
      [],
      [
        update({
          sessionUpdate: "tool_call",
          toolCallId: "edit",
          title: "Update document",
          kind: "edit",
          status: "completed",
          locations: [{ path: "/agent/report.md", line: 2 }],
          content: [
            { type: "diff", path: "/agent/report.md", oldText: "Before", newText: "After" },
            { type: "content", content: { type: "text", text: "**Document updated**" } },
          ],
          rawOutput: { ok: true },
        }),
      ],
    );
    render(<AcpTranscript blocks={blocks} onAnswerPermission={noop} />);
    await userEvent.click(screen.getByText("Update document"));
    expect(screen.getByTestId("acp-tool-locations")).toHaveTextContent("/agent/report.md:2");
    const diff = screen.getByTestId("acp-tool-diff");
    await userEvent.click(within(diff).getByText("/agent/report.md"));
    expect(within(diff).getByLabelText("Previous content")).toHaveTextContent("Before");
    expect(within(diff).getByLabelText("Updated content")).toHaveTextContent("After");
    expect(screen.getByText("Document updated")).toBeVisible();
    expect(screen.getByTestId("acp-tool-raw-output")).toHaveTextContent("ok");
  });
  it("keeps text and rich resources in their received order", () => {
    const events = [
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Before image" },
      }),
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      }),
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "After image" },
      }),
    ];
    render(<AcpTranscript blocks={reduceAcpEvents([], events)} onAnswerPermission={noop} />);
    const image = screen.getByRole("img");
    expect(
      screen.getByText("Before image").compareDocumentPosition(image) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      image.compareDocumentPosition(screen.getByText("After image")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("resources", () => {
  it("never exposes remote file paths or unsafe schemes as browser links", () => {
    expect(safeResourceUrl("file:///agent/secret.txt")).toBeUndefined();
    expect(safeResourceUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeResourceUrl("data:text/html;base64,abc")).toBeUndefined();
    render(<AcpResourceView resource={{ id: "file", uri: "buda://file/1", name: "report.pdf" }} />);
    expect(screen.getByText("report.pdf")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("resolves a resource through the host and retries failures", async () => {
    const resolver = vi
      .fn()
      .mockRejectedValueOnce(new Error("Link expired"))
      .mockResolvedValueOnce({
        id: "file",
        uri: "https://files.example/report.png",
        name: "report.png",
        mimeType: "image/png",
      });
    render(
      <AcpResourceView
        resource={{ id: "file", uri: "buda://file/1", name: "report.png" }}
        resolveResource={resolver}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Link expired");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("img", { name: "report.png" })).toHaveAttribute(
      "src",
      "https://files.example/report.png",
    );
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "https://files.example/report.png",
    );
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

const question: AcpInputBlock = {
  kind: "input_request",
  id: "question",
  message: "Choose your implementation",
  resolution: "pending",
  requestedSchema: {
    type: "object",
    required: ["approach", "topics", "notes"],
    properties: {
      approach: { type: "string", title: "Approach", enum: ["small", "full"] },
      topics: { type: "array", title: "Topics", items: { type: "string", enum: ["UI", "API"] } },
      notes: { type: "string", title: "Notes" },
    },
  },
};

describe("structured user input", () => {
  it("collects single/multiple/free text answers and preserves selection on failure", async () => {
    const answer = vi.fn();
    const { rerender } = render(<AcpInputView block={question} onAnswer={answer} />);
    await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(answer).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText("Approach *"), "full");
    await userEvent.click(screen.getByLabelText("API"));
    await userEvent.type(screen.getByLabelText("Notes *"), "Keep history");
    await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(answer).toHaveBeenCalledWith({
      action: "accept",
      content: { approach: "full", topics: ["API"], notes: "Keep history" },
    });
    rerender(<AcpInputView block={{ ...question, error: "Try again" }} onAnswer={answer} />);
    expect(screen.getByLabelText("Notes *")).toHaveValue("Keep history");
    expect(screen.getByLabelText("API")).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("Try again");
  });
  it("offers distinct decline and cancel decisions and disables an in-flight answer", async () => {
    const answer = vi.fn();
    const { rerender } = render(<AcpInputView block={question} onAnswer={answer} />);
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(answer).toHaveBeenLastCalledWith({ action: "decline" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(answer).toHaveBeenLastCalledWith({ action: "cancel" });
    rerender(<AcpInputView block={{ ...question, resolution: "answering" }} onAnswer={answer} />);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(answer).toHaveBeenCalledTimes(2);
  });
  it("renders restored answers read-only and keeps unknown schemas visible", () => {
    const { rerender } = render(
      <AcpInputView
        block={{
          ...question,
          resolution: { action: "accept", content: { approach: "full", topics: ["API"] } },
        }}
      />,
    );
    expect(screen.getByText("Answered")).toBeVisible();
    expect(screen.getByText("full")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(
      <AcpInputView
        block={{
          ...question,
          requestedSchema: { type: "object", properties: { nested: { type: "object" } } },
        }}
        onAnswer={noop}
      />,
    );
    expect(screen.getByText("This client cannot answer this request.")).toBeVisible();
  });
});

describe("additional replay and preview cases", () => {
  it("keeps an answer visible when trailing metadata-only messages arrive", () => {
    const blocks = reduceAcpEvents(
      [],
      [
        running[0],
        update({
          sessionUpdate: "agent_message_chunk",
          messageId: "answer",
          content: { type: "text", text: "Keep this answer visible." },
        }),
        update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "" },
          _meta: { diagnostics: { ok: true } },
        }),
        {
          type: "lifecycle",
          event: {
            version: 1,
            type: "turn_finished",
            turnId: "turn",
            at,
            stopReason: "end_turn",
            usage: { inputTokens: 12, outputTokens: 5 },
          },
        },
      ],
    );
    render(<AcpTranscript blocks={blocks} onAnswerPermission={noop} />);
    expect(screen.getByText("Keep this answer visible.")).toBeVisible();
    expect(screen.getAllByTestId("acp-message-agent")).toHaveLength(1);
    expect(screen.getByTestId("acp-turn-usage")).toHaveTextContent(
      "12 input tokens · 5 output tokens",
    );
  });
  it("previews an authorized text document inside the panel", async () => {
    render(
      <AcpResourceView
        resource={{
          id: "notes",
          uri: "data:text/plain;charset=utf-8,Hello%20document",
          name: "notes.txt",
          mimeType: "text/plain",
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Hello document")).toBeVisible();
    expect(screen.getByRole("link", { name: "Download" })).toBeVisible();
  });
  it("renders related calls as an expandable subtask without hiding cyclic metadata", async () => {
    const blocks = reduceAcpEvents(
      [],
      [
        update({
          sessionUpdate: "tool_call",
          toolCallId: "parent",
          title: "Research task",
          kind: "think",
          status: "completed",
        }),
        update({
          sessionUpdate: "tool_call",
          toolCallId: "child",
          title: "Read nested source",
          kind: "read",
          status: "in_progress",
          _meta: { "bunny-agent/parentToolCallId": "parent" },
        }),
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "child",
          status: "completed",
          _meta: { "buda.im": { seq: 3, eventId: "session:3" } },
        }),
      ],
    );
    const { rerender } = render(<AcpTranscript blocks={blocks} onAnswerPermission={noop} />);
    await userEvent.click(screen.getByTestId("acp-tool-run"));
    await userEvent.click(
      within(screen.getByTestId("acp-subtasks")).getByRole("button", { name: "1 subtask tools" }),
    );
    expect(screen.getByText("Read nested source")).toBeVisible();
    rerender(
      <AcpTranscript
        blocks={[{ ...blocks[0], _meta: { parentToolCallId: "child" } } as AcpBlock, blocks[1]]}
        onAnswerPermission={noop}
      />,
    );
    expect(screen.getByText("Research task")).toBeVisible();
    expect(screen.getByTestId("acp-subtasks")).toBeInTheDocument();
  });
});

describe("stopped interaction cards", () => {
  it("makes pending input and permission cards read-only after stopping", async () => {
    const onPermission = vi.fn();
    const onInput = vi.fn();
    const blocks = reduceAcpEvents(
      [],
      [
        running[0],
        {
          type: "permission_request",
          requestId: "stop-permission",
          title: "Run a tool?",
          options: [{ optionId: "yes", name: "Allow" }],
        },
        {
          type: "input_request",
          requestId: "stop-input",
          message: "Choose a value",
          requestedSchema: { type: "object", properties: { text: { type: "string" } } },
        },
        {
          type: "lifecycle",
          event: { version: 1, type: "turn_finished", turnId: "turn", at, stopReason: "cancelled" },
        },
      ],
    );
    render(
      <AcpTranscript blocks={blocks} onAnswerPermission={onPermission} onAnswerInput={onInput} />,
    );
    expect(screen.getByTestId("acp-process-summary")).toHaveTextContent("Stopped");
    expect(screen.getByTestId("acp-process-summary")).not.toHaveTextContent("Waiting");
    await userEvent.click(screen.getByTestId("acp-process-summary"));
    expect(screen.getByTestId("acp-permission-cancelled")).toHaveTextContent("Cancelled");
    expect(screen.getByTestId("acp-input-request")).toHaveTextContent("Cancelled");
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send answer" })).not.toBeInTheDocument();
    expect(onPermission).not.toHaveBeenCalled();
    expect(onInput).not.toHaveBeenCalled();
  });
});

describe("unknown decision confirmation", () => {
  it("locks submitted fields and offers only retry of the recorded answer", async () => {
    const onAnswer = vi.fn();
    const response = {
      action: "accept" as const,
      content: { approach: "full", topics: ["API"], notes: "Original answer" },
    };
    render(
      <AcpInputView
        block={{
          ...question,
          submittedResponse: response,
          confirmationUnknown: true,
          error: "ACK lost",
        }}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByLabelText("Notes *")).toHaveValue("Original answer");
    expect(screen.getByLabelText("Notes *")).toBeDisabled();
    expect(screen.getByLabelText("Approach *")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry the same answer" }));
    expect(onAnswer).toHaveBeenCalledWith(response);
  });
});

describe("multi-block final answers", () => {
  it("keeps every trailing answer block visible after the process collapses", () => {
    const blocks = reduceAcpEvents(
      [],
      [
        running[0],
        update({
          sessionUpdate: "tool_call",
          toolCallId: "read",
          title: "Read",
          status: "completed",
        }),
        update({
          sessionUpdate: "agent_message_chunk",
          messageId: "paragraph-1",
          content: { type: "text", text: "First answer paragraph." },
        }),
        update({
          sessionUpdate: "agent_message_chunk",
          messageId: "paragraph-2",
          content: { type: "text", text: "Second answer paragraph." },
        }),
        {
          type: "lifecycle",
          event: { version: 1, type: "turn_finished", turnId: "turn", at, stopReason: "end_turn" },
        },
      ],
    );
    render(<AcpTranscript blocks={blocks} onAnswerPermission={noop} />);
    expect(screen.getByTestId("acp-process-summary")).toHaveAttribute("data-state", "closed");
    expect(screen.getByText("First answer paragraph.")).toBeVisible();
    expect(screen.getByText("Second answer paragraph.")).toBeVisible();
  });
});

describe("interrupted process rendering", () => {
  it("stops the observed running process and keeps partial tool output inspectable", async () => {
    const events: AcpUiEvent[] = [
      running[0],
      update({
        sessionUpdate: "tool_call",
        toolCallId: "partial",
        title: "Read partial source",
        status: "in_progress",
        content: [
          { type: "content", content: { type: "text", text: "Partial result remains available." } },
        ],
      }),
      { type: "interrupted", at: "2026-10-26T10:00:03.000Z" },
    ];
    render(<AcpTranscript blocks={reduceAcpEvents([], events)} onAnswerPermission={noop} />);
    const process = screen.getByTestId("acp-process");
    expect(process).toHaveAttribute("data-status", "interrupted");
    expect(screen.getByTestId("acp-process-summary")).toHaveTextContent("Interrupted");
    expect(screen.getByTestId("acp-process-summary").querySelector(".animate-spin")).toBeNull();
    await userEvent.click(screen.getByTestId("acp-process-summary"));
    await userEvent.click(screen.getByText("Read partial source"));
    expect(screen.getByTestId("acp-tool-output")).toHaveTextContent(
      "Partial result remains available.",
    );
    expect(screen.getByTestId("acp-tool-call")).toHaveTextContent("Interrupted");
  });
});

describe("SDK titled multi-select rendering", () => {
  it("submits enum values from anyOf while displaying the titles", async () => {
    const answer = vi.fn();
    const block: AcpInputBlock = {
      kind: "input_request",
      id: "titled-multi",
      message: "Choose topics",
      resolution: "pending",
      requestedSchema: {
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
      },
    };
    render(<AcpInputView block={block} onAnswer={answer} />);
    await userEvent.click(screen.getByLabelText("User interface"));
    await userEvent.click(screen.getByLabelText("API behavior"));
    await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(answer).toHaveBeenCalledWith({ action: "accept", content: { topics: ["ui", "api"] } });
  });
});
