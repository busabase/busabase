import {
  type AcpAttachment,
  type AcpUiEvent,
  reduceAcpEvent,
  reduceAcpEvents,
} from "@acp-ui/core/reduce";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AcpMessageView } from "./message-view";

const fullText = '<script>alert("x")</script>\n\n目标：Visits\n\nComplete connection instructions';
const events: AcpUiEvent[] = [
  {
    type: "session_update",
    update: {
      sessionUpdate: "user_message_chunk",
      messageId: "message-1",
      content: { type: "text", text: "Only this week" },
    },
  },
  {
    type: "session_update",
    update: {
      sessionUpdate: "user_message_chunk",
      messageId: "message-1",
      content: {
        type: "resource",
        resource: {
          uri: "busabase-agent-prompt:///snapshot-1",
          mimeType: "text/plain",
          text: fullText,
        },
        _meta: {
          "acp-ui.resourceContext": { id: "snapshot-1", name: "Find records · Visits" },
          "busabase.agentPrompt": { scenarioId: "find-records" },
        },
      },
    },
  },
];
const Markdown = ({ children }: { children: string }) => <p data-testid="markdown">{children}</p>;

describe("semantic prompt context replay", () => {
  it("keeps live/replayed content identical and renders only a chip until inspected", async () => {
    const replay = reduceAcpEvents([], events);
    expect(events.reduce(reduceAcpEvent, [])).toEqual(replay);
    const block = replay[0];
    if (block?.kind !== "message") throw new Error("Expected message");
    const resolver = vi.fn();
    render(
      <AcpMessageView
        block={block}
        Markdown={Markdown}
        resolveResource={resolver}
        resourceLabels={{ preview: "查看内容" }}
      />,
    );
    expect(screen.getByTestId("markdown")).toHaveTextContent("Only this week");
    expect(screen.queryByText(fullText)).not.toBeInTheDocument();
    expect(screen.queryByTestId("acp-resource")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove context" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "查看内容: Find records · Visits" }));
    expect(screen.getByRole("region").textContent).toBe(fullText);
    expect(document.querySelector("script")).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("retains host renderer overrides with the complete canonical resource metadata", () => {
    const block = reduceAcpEvents([], events)[0];
    if (block?.kind !== "message") throw new Error("Expected message");
    const attachmentRenderer = vi.fn((_attachment: AcpAttachment) => (
      <span>Host context card</span>
    ));
    render(
      <AcpMessageView block={block} Markdown={Markdown} renderAttachment={attachmentRenderer} />,
    );
    expect(screen.getByText("Host context card")).toBeVisible();
    expect(attachmentRenderer.mock.calls[0]?.[0]).toMatchObject({
      resource: block.content?.[1],
    });
  });

  it("ignores a malformed context marker and preserves ordinary resource rendering", () => {
    const malformed = structuredClone(events);
    const last = malformed[1];
    if (last?.type !== "session_update" || last.update.sessionUpdate !== "user_message_chunk")
      throw new Error("Expected content");
    last.update.content._meta = { "acp-ui.resourceContext": { id: 1, name: "Bad" } };
    const block = reduceAcpEvents([], malformed)[0];
    if (block?.kind !== "message") throw new Error("Expected message");
    render(<AcpMessageView block={block} Markdown={Markdown} />);
    expect(screen.queryByRole("button", { name: /^Inspect context:/ })).not.toBeInTheDocument();
    expect(screen.getByText("snapshot-1")).toBeVisible();
    expect(document.querySelector("pre")?.textContent).toBe(fullText);
  });
});
