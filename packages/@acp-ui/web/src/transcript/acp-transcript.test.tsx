import type { AcpBlock, AcpPermissionBlock } from "@acp-ui/core/reduce";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AcpTranscript } from "./acp-transcript";

const noop = () => undefined;

const renderBlocks = (
  blocks: AcpBlock[],
  onAnswer: (block: AcpPermissionBlock, optionId: string) => void = noop,
  props: Partial<React.ComponentProps<typeof AcpTranscript>> = {},
) => render(<AcpTranscript blocks={blocks} onAnswerPermission={onAnswer} {...props} />);

const message = (over: Partial<AcpBlock> = {}): AcpBlock =>
  ({
    kind: "message",
    id: "m1",
    role: "agent",
    variant: "message",
    text: "hello",
    ...over,
  }) as AcpBlock;

describe("messages", () => {
  // The headline capability neither prior ACP implementation had: both rendered
  // raw text, so an agent replying with a list or a code fence showed literal
  // asterisks and backticks.
  it("renders agent markdown as markdown", () => {
    renderBlocks([message({ text: "# Heading\n\n- one\n- two" })]);
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("puts a user message on the user side and an agent message on the other", () => {
    renderBlocks([
      message({ id: "u1", role: "user", text: "hi" }),
      message({ id: "a1", role: "agent", text: "hello" }),
    ]);
    expect(screen.getByTestId("acp-message-user")).toHaveTextContent("hi");
    expect(screen.getByTestId("acp-message-agent")).toHaveTextContent("hello");
  });

  it("renders a thought as a reasoning panel, not as a reply bubble", () => {
    renderBlocks([message({ variant: "thought", text: "let me think" })]);
    expect(screen.getByTestId("acp-thought")).toBeInTheDocument();
    expect(screen.queryByTestId("acp-message-agent")).not.toBeInTheDocument();
  });
});

describe("attachments", () => {
  it("renders an image attachment inside the message bubble", () => {
    renderBlocks([
      message({
        text: "here's a screenshot",
        attachments: [{ kind: "image", data: "abc123", mimeType: "image/png" }],
      }),
    ]);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "data:image/png;base64,abc123");
  });

  it("renders text and an attachment together, not one or the other", () => {
    renderBlocks([
      message({
        text: "check this out",
        attachments: [{ kind: "image", data: "abc123", mimeType: "image/png" }],
      }),
    ]);
    expect(screen.getByText("check this out")).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("renders an attachment-only message (no caption) without an empty paragraph", () => {
    renderBlocks([
      message({ text: "", attachments: [{ kind: "image", data: "x", mimeType: "image/png" }] }),
    ]);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("renders multiple attachments on one message", () => {
    renderBlocks([
      message({
        text: "two shots",
        attachments: [
          { kind: "image", data: "one", mimeType: "image/png" },
          { kind: "image", data: "two", mimeType: "image/jpeg" },
        ],
      }),
    ]);
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("renders nothing extra for a message with no attachments", () => {
    renderBlocks([message({ text: "plain text" })]);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("tool calls", () => {
  const tool = (status: string): AcpBlock =>
    ({
      kind: "tool_call",
      id: "t1",
      title: "Read package.json",
      toolKind: "read",
      status,
    }) as AcpBlock;

  it.each([
    ["pending", "Pending"],
    ["in_progress", "Running"],
    ["completed", "Completed"],
    ["failed", "Error"],
  ])("shows %s as %s", (status, label) => {
    renderBlocks([tool(status)]);
    expect(screen.getByTestId("acp-tool-call")).toHaveTextContent(label);
    expect(screen.getByTestId("acp-tool-call")).toHaveTextContent("Read package.json");
  });

  // The structural fix carried through from the core: one call is one row, no
  // matter how many `tool_call_update`s it received.
  it("renders one row per tool call", () => {
    renderBlocks([tool("completed")]);
    expect(screen.getAllByTestId("acp-tool-call")).toHaveLength(1);
  });

  // buda's "Explored N files, ran N commands" pattern: 2+ consecutive tool
  // calls collapse into one summary row rather than N flat rows.
  it("collapses consecutive tool calls into one run, buda-style", () => {
    renderBlocks([tool("completed"), tool("completed")]);
    expect(screen.getAllByTestId("acp-tool-run")).toHaveLength(1);
    expect(screen.queryByTestId("acp-tool-call")).not.toBeInTheDocument();
  });

  it("does not merge tool calls separated by a message", () => {
    renderBlocks([tool("completed"), tool("completed"), message(), tool("completed")]);
    expect(screen.getAllByTestId("acp-tool-run")).toHaveLength(1);
    expect(screen.getAllByTestId("acp-tool-call")).toHaveLength(1);
  });
});

describe("permission", () => {
  const permission = (over: Partial<AcpPermissionBlock> = {}): AcpBlock =>
    ({
      kind: "permission",
      id: "p1",
      title: "Run `rm -rf build`?",
      options: [
        { optionId: "once", name: "Allow once", kind: "allow_once" },
        { optionId: "always", name: "Always allow", kind: "allow_always" },
        { optionId: "no", name: "Reject", kind: "reject_once" },
      ],
      resolution: "pending",
      ...over,
    }) as AcpBlock;

  // The reason the whole stack bypasses the AI SDK: a boolean `approved` cannot
  // carry these three distinct answers.
  it("offers every option as its own button", async () => {
    const onAnswer = vi.fn();
    renderBlocks([permission()], onAnswer);

    for (const name of ["Allow once", "Always allow", "Reject"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }

    await userEvent.click(screen.getByRole("button", { name: "Always allow" }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][1]).toBe("always");
  });

  // busabase blocks indefinitely and deliberately never auto-approves. If this
  // component ever answered on its own, that security property would be gone
  // and nothing else in the stack would notice.
  it("never answers on its own", () => {
    const onAnswer = vi.fn();
    renderBlocks([permission()], onAnswer);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("disables the buttons while an answer is in flight", () => {
    renderBlocks([permission({ resolution: "answering" })]);
    expect(screen.getByRole("button", { name: "Allow once" })).toBeDisabled();
  });

  it("shows which option was chosen once resolved", () => {
    renderBlocks([permission({ resolution: { optionId: "always" } })]);
    expect(screen.getByTestId("acp-permission-answer")).toHaveTextContent("Always allow");
    expect(screen.queryByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
  });

  it("shows no countdown when the host set no deadline (busabase)", () => {
    renderBlocks([permission()]);
    expect(screen.queryByTestId("acp-permission-countdown")).not.toBeInTheDocument();
  });

  it("counts down when the host set a deadline (acprouter)", () => {
    const timeoutAt = new Date(Date.now() + 90_000).toISOString();
    renderBlocks([permission({ timeoutAt })]);
    expect(screen.getByTestId("acp-permission-countdown")).toHaveTextContent(/Times out in 9\ds/);
  });
});

describe("notes", () => {
  it("renders a session note", () => {
    renderBlocks([{ kind: "note", id: "n1", text: "No workspace access." }]);
    expect(screen.getByTestId("acp-note")).toHaveTextContent("No workspace access.");
  });

  it("marks a terminal note distinctly", () => {
    renderBlocks([{ kind: "note", id: "n1", text: "Session ended", ended: true }]);
    expect(screen.getByTestId("acp-note-ended")).toBeInTheDocument();
  });
});

// The headless half of the design: a host swaps one renderer without
// reimplementing the reduction or forking the package.
describe("slots", () => {
  it("uses an injected block renderer instead of the default", () => {
    renderBlocks([{ kind: "note", id: "n1", text: "hi" }], noop, {
      slots: { Note: ({ block }) => <div data-testid="custom-note">{block.text}</div> },
    });
    expect(screen.getByTestId("custom-note")).toBeInTheDocument();
    expect(screen.queryByTestId("acp-note")).not.toBeInTheDocument();
  });

  it("uses an injected tool-run renderer instead of the default", () => {
    const tool = (id: string): AcpBlock =>
      ({ kind: "tool_call", id, title: id, toolKind: "read", status: "completed" }) as AcpBlock;
    renderBlocks([tool("t1"), tool("t2")], noop, {
      slots: { ToolRun: ({ blocks }) => <div data-testid="custom-run">{blocks.length}</div> },
    });
    expect(screen.getByTestId("custom-run")).toHaveTextContent("2");
    expect(screen.queryByTestId("acp-tool-run")).not.toBeInTheDocument();
  });

  it("uses an injected markdown engine", () => {
    renderBlocks([message({ text: "# Heading" })], noop, {
      slots: { Markdown: ({ children }) => <pre data-testid="raw">{children}</pre> },
    });
    expect(screen.getByTestId("raw")).toHaveTextContent("# Heading");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
