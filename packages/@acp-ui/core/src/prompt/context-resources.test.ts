import type { ContentBlock } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { reduceAcpEvents } from "../reduce";
import { attachmentToContentBlock } from "./attachment-media";
import {
  AGENT_PROMPT_CONTEXT_TEXT_FALLBACK_NOTE,
  buildPromptContent,
} from "./build-prompt-content";

const referenceText = "# Reference material\nSource: Visits\n\nA secret marker: 你好_CONTEXT_837";
const resource: Extract<ContentBlock, { type: "resource" }> = {
  type: "resource",
  resource: {
    uri: "busabase://spaces/local/nodes/nod_1",
    mimeType: "text/markdown",
    text: referenceText,
  },
  annotations: { audience: ["user", "assistant"], lastModified: "2026-10-26T01:02:03Z" },
  _meta: { "busabase.node": { id: "nod_1", name: "Visits", type: "base" } },
};

describe("explicit context resources", () => {
  it.each([true, false, undefined])(
    "keeps prompt snapshots complete and ordered with files; embeddedContext=%s",
    (embeddedContext) => {
      const promptSnapshot = {
        ...resource,
        resource: {
          uri: "busabase-agent-prompt:///one",
          mimeType: "text/plain",
          text: "完整提示词\n\nTask  ",
        },
        _meta: { "acp-ui.resourceContext": { id: "one", name: "Find records · 目标" } },
      };
      const image = { kind: "image" as const, mimeType: "image/png", data: "AA==" };
      const built = buildPromptContent(
        "My instruction",
        [image],
        { image: true, embeddedContext },
        [promptSnapshot],
      );
      expect(built.prompt[0]).toEqual({ type: "text", text: "My instruction" });
      expect(built.prompt[1]).toEqual(
        embeddedContext
          ? promptSnapshot
          : {
              type: "text",
              text: promptSnapshot.resource.text,
              annotations: resource.annotations,
            },
      );
      expect(built.prompt[2]).toMatchObject({ type: "image", data: "AA==" });
      expect(built.notes).toEqual(embeddedContext ? [] : [AGENT_PROMPT_CONTEXT_TEXT_FALLBACK_NOTE]);
    },
  );
  it("places downgraded text files after context without mixing them into user-authored text", () => {
    const promptSnapshot = {
      ...resource,
      _meta: { "acp-ui.resourceContext": { id: "one", name: "Find records" } },
    };
    const built = buildPromptContent(
      "My instruction",
      [
        {
          kind: "file",
          mimeType: "text/plain",
          data: "QXR0YWNobWVudCBjb250ZW50",
          filename: "notes.txt",
        },
      ],
      {},
      [promptSnapshot],
    );
    expect(built.prompt).toEqual([
      { type: "text", text: "My instruction" },
      { type: "text", text: referenceText, annotations: resource.annotations },
      {
        type: "text",
        text: "--- Attached file: notes.txt ---\nAttachment content\n--- End of attached file: notes.txt ---",
      },
    ]);
    expect(built.notes).toContain(AGENT_PROMPT_CONTEXT_TEXT_FALLBACK_NOTE);
  });
  it("embeds the exact resource only when the agent declares support", () => {
    const built = buildPromptContent("read this", undefined, { embeddedContext: true }, [resource]);
    expect(built.prompt).toEqual([{ type: "text", text: "read this" }, resource]);
    expect(built.prompt[1]).toBe(resource);
    expect(built.notes).toEqual([]);
  });

  it.each([undefined, null, {}, { embeddedContext: false }])(
    "uses separate actual text when capabilities are %j",
    (capabilities) => {
      const second = { ...resource, resource: { ...resource.resource, text: "Second snapshot" } };
      const built = buildPromptContent("unchanged user text", undefined, capabilities, [
        resource,
        second,
      ]);
      expect(built.prompt).toEqual([
        { type: "text", text: "unchanged user text" },
        { type: "text", text: referenceText, annotations: resource.annotations },
        { type: "text", text: "Second snapshot", annotations: resource.annotations },
      ]);
      expect(built.prompt.some((block) => block.type === "resource_link")).toBe(false);
    },
  );

  it("can send a context reference without a caption", () => {
    const { prompt } = buildPromptContent("", undefined, {}, [resource]);
    expect(prompt[0]).toEqual({ type: "text", text: "" });
    expect(prompt[1]).toMatchObject({ type: "text", text: referenceText });
  });

  it("fails explicitly for binary context that cannot be represented as text", () => {
    expect(() =>
      buildPromptContent("read", undefined, {}, [
        {
          type: "resource",
          resource: { uri: "binary:///1", mimeType: "application/pdf", blob: "AA==" },
        },
      ]),
    ).toThrow("cannot read embedded binary context");
  });

  it("keeps identity, annotations and display metadata across reduction and re-encoding", () => {
    const blocks = reduceAcpEvents(
      [],
      [
        {
          type: "session_update",
          update: { sessionUpdate: "user_message_chunk", content: resource, messageId: "m1" },
        },
      ],
    );
    const block = blocks[0];
    expect(block?.kind).toBe("message");
    if (block?.kind !== "message") throw new Error("Expected resource message");
    const attachment = block.attachments?.[0];
    expect(attachment?.resource).toEqual(resource);
    expect(attachment?.mimeType).toBe("text/markdown");
    expect(attachment).toBeDefined();
    if (!attachment) throw new Error("Expected resource attachment");
    expect(attachmentToContentBlock(attachment)).toEqual(resource);
    expect(Buffer.from(attachment.data, "base64").toString("utf8")).toBe(referenceText);
  });
});
