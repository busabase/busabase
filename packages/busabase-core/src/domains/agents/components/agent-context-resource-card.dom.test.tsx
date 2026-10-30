// @vitest-environment jsdom
import { attachmentToContentBlock } from "@acp-ui/core/prompt";
import {
  type AcpAttachment,
  type AcpMessageBlock,
  type ContentBlock,
  reduceAcpEvents,
} from "@acp-ui/core/reduce";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { contextResourceToContentBlock } from "../utils/agent-context-resources";
import {
  AgentContextResourceCard,
  BusabaseAgentMessageView,
  contextNodeOf,
} from "./agent-context-resource-card";

const snapshot = {
  nodeId: "nod-doc",
  nodeType: "doc",
  name: "Source document",
  slug: "source",
  icon: { type: "emoji" as const, value: "📚" },
  truncated: true,
  uri: "busabase://spaces/local/nodes/nod-doc",
  mimeType: "text/markdown",
  text: "Only the original snapshot",
  annotations: { audience: ["user" as const, "assistant" as const] },
};
const attachment: AcpAttachment = {
  kind: "file",
  data: btoa(snapshot.text),
  mimeType: snapshot.mimeType,
  resource: contextResourceToContentBlock(snapshot),
};
afterEach(cleanup);

const renderMessage = (overrides: Partial<AcpMessageBlock> = {}) =>
  render(
    <CoreI18nProvider>
      <BusabaseAgentMessageView
        block={{
          kind: "message",
          id: "message-context",
          role: "user",
          variant: "message",
          text: "Inspect these references",
          attachments: [attachment],
          ...overrides,
        }}
        Markdown={({ children }) => <p>{children}</p>}
      />
    </CoreI18nProvider>,
  );

describe("sent context chips", () => {
  it("uses the node chip itself to toggle its exact snapshot and separate navigation", () => {
    render(
      <CoreI18nProvider>
        <AgentContextResourceCard attachment={attachment} />
      </CoreI18nProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Source document" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("View sent context")).toBeNull();
    expect(document.querySelector("summary")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Open Source document" }).getAttribute("href")).toBe(
      "/doc/nod-doc",
    );
    const region = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    expect(region?.hidden).toBe(false);
    expect(region?.querySelector("pre")?.textContent).toBe(snapshot.text);
    expect(screen.getByText(/content was truncated/)).toBeTruthy();
    expect(attachmentToContentBlock(attachment)).toEqual(attachment.resource);
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(region?.hidden).toBe(true);
  });
  it("rejects malformed metadata but still exposes literal Unicode text without a node link", () => {
    expect(contextNodeOf({ kind: "file", data: "YQ==", mimeType: "text/plain" })).toBeNull();
    const forged = {
      ...attachment,
      resource: {
        ...contextResourceToContentBlock(snapshot),
        _meta: {
          "busabase.node": {
            id: "x",
            type: "../../evil",
            name: "bad",
            slug: "bad",
            truncated: false,
          },
        },
      },
    };
    expect(contextNodeOf(forged)).toBeNull();
    const text = '中文 🚀\n<script>alert("not executable")</script>';
    renderMessage({
      attachments: [
        {
          ...forged,
          filename: "Text reference",
          resource: { ...forged.resource, resource: { uri: "context:///text", text } },
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Text reference" }));
    expect(screen.getByTestId("agent-context-resource").querySelector("pre")?.textContent).toBe(
      text,
    );
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("handles empty attached text without silently hiding it", () => {
    renderMessage({
      attachments: [
        {
          ...attachment,
          resource: { type: "resource", resource: { uri: "context:///empty", text: "" } },
        },
      ],
    });
    const trigger = screen.getByRole("button", { name: "Empty" });
    fireEvent.click(trigger);
    expect(document.getElementById(trigger.getAttribute("aria-controls") ?? "")?.hidden).toBe(
      false,
    );
    expect(screen.getByTestId("agent-context-resource").querySelector("pre")?.textContent).toBe(
      "Empty",
    );
  });

  it("encodes the node route without navigating when the chip opens", () => {
    renderMessage({
      attachments: [
        {
          ...attachment,
          resource: contextResourceToContentBlock({ ...snapshot, nodeId: "node/中文?" }),
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Source document" }));
    expect(screen.getByRole("link").getAttribute("href")).toBe("/doc/node%2F%E4%B8%AD%E6%96%87%3F");
  });

  it.each([false, true])("opens file details, including node blobs (node=%s)", async (node) => {
    renderMessage({
      attachments: [
        {
          kind: "file",
          data: "YQ==",
          filename: "report.pdf",
          mimeType: "application/pdf",
          ...(node
            ? {
                resource: {
                  ...contextResourceToContentBlock(snapshot),
                  resource: { uri: "https://example.com/report.pdf", blob: "YQ==" },
                },
              }
            : {}),
        },
      ],
    });
    const trigger = screen.getByRole("button", { name: "report.pdf" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "report.pdf" });
    expect(within(dialog).getByText("application/pdf")).toBeTruthy();
    const download = within(dialog).getByRole("link", { name: "Download file" });
    expect(download.getAttribute("href")).toBe("data:application/octet-stream;base64,YQ==");
    expect(download.getAttribute("download")).toBe("report.pdf");
    if (node)
      expect(within(dialog).getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
        "https://example.com/report.pdf",
      );
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "busabase://nodes/one",
    "data:text/html,test",
    "/relative",
  ])("never activates unsafe or unresolved file URI %s", (uri) => {
    renderMessage({
      attachments: [
        {
          kind: "file",
          data: "YQ==",
          mimeType: "application/pdf",
          resource: { type: "resource", resource: { uri, blob: "YQ==" } },
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "File" }));
    const dialog = screen.getByRole("dialog", { name: "File" });
    expect(within(dialog).getByText(uri)).toBeTruthy();
    expect(within(dialog).queryByRole("link", { name: "Open" })).toBeNull();
    expect(within(dialog).getByRole("link", { name: "Download file" }).getAttribute("href")).toBe(
      "data:application/octet-stream;base64,YQ==",
    );
  });

  it.each([false, true])(
    "keeps canonical order and independent repeated snapshots (replay=%s)",
    (replay) => {
      const content: ContentBlock[] = [
        { type: "text", text: "Before" },
        contextResourceToContentBlock(snapshot),
        { type: "image", data: "YQ==", mimeType: "image/png" },
        { type: "text", text: "Between" },
        contextResourceToContentBlock({ ...snapshot, text: "Later snapshot" }),
        {
          type: "resource",
          resource: {
            uri: "https://example.com/file.pdf",
            blob: "YQ==",
            mimeType: "application/pdf",
          },
        },
        { type: "audio", data: "YQ==", mimeType: "audio/wav" },
        { type: "text", text: "After" },
      ];
      const blocks = reduceAcpEvents(
        [],
        content.map((item) => ({
          type: "session_update" as const,
          update: { sessionUpdate: "user_message_chunk" as const, content: item },
        })),
      );
      const block = blocks.find((item): item is AcpMessageBlock => item.kind === "message");
      if (!block) throw new Error("Expected a projected message");
      renderMessage(replay ? JSON.parse(JSON.stringify(block)) : block);
      const triggers = screen.getAllByRole("button", { name: "Source document" });
      expect(triggers).toHaveLength(2);
      expect(new Set(triggers.map((trigger) => trigger.getAttribute("aria-controls"))).size).toBe(
        2,
      );
      for (const trigger of triggers) fireEvent.click(trigger);
      const cards = screen.getAllByTestId("agent-context-resource");
      const [firstCard, secondCard] = cards;
      if (!firstCard || !secondCard) throw new Error("Expected two snapshot chips");
      expect(firstCard.querySelector("pre")?.textContent).toBe(snapshot.text);
      expect(secondCard.querySelector("pre")?.textContent).toBe("Later snapshot");
      const ordered = [
        screen.getByText("Before"),
        firstCard,
        screen.getByRole("img"),
        screen.getByText("Between"),
        secondCard,
        screen.getByRole("button", { name: "file.pdf" }),
        screen.getByLabelText("Agent audio"),
        screen.getByText("After"),
      ];
      let previous: Element | undefined;
      for (const element of ordered) {
        if (previous)
          expect(
            previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
        previous = element;
      }
    },
  );

  it.each(["image", "file"] as const)(
    "keeps ordinary images (kind=%s) and reasoning on the shared renderer",
    (kind) => {
      const rendered = renderMessage({
        attachments: [{ kind, data: "YQ==", mimeType: "image/png", filename: "photo.png" }],
      });
      expect(screen.getByRole("img").getAttribute("src")).toBe("data:image/png;base64,YQ==");
      expect(screen.queryByTestId("agent-context-resource")).toBeNull();
      rendered.unmount();
      renderMessage({ variant: "thought", text: "Working through the evidence", attachments: [] });
      expect(screen.getByTestId("acp-thought")).toBeTruthy();
      expect(screen.queryByTestId("agent-context-resource")).toBeNull();
    },
  );
});
