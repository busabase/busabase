import { type AcpUiEvent, reduceAcpEvents } from "@acp-ui/core/reduce";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AcpTranscript } from "./acp-transcript";

it("renders Markdown across adjacent text chunks that retain transport metadata", () => {
  const chunks = ["# Hea", "ding\n\n```ts\nconst ", "value = 1;\n```"];
  const events: AcpUiEvent[] = chunks.map((text, index) => ({
    type: "session_update",
    update: {
      sessionUpdate: "agent_message_chunk",
      messageId: "reply",
      content: { type: "text", text },
      _meta: { "buda.im": { seq: index + 1, eventId: `reply:${index + 1}` } },
    },
  }));
  render(
    <AcpTranscript blocks={reduceAcpEvents([], events)} onAnswerPermission={() => undefined} />,
  );
  expect(screen.getByRole("heading", { name: "Heading" })).toBeVisible();
  expect(screen.getAllByRole("code")).toHaveLength(1);
  expect(screen.getByRole("code")).toHaveTextContent("const value = 1;");
});
