import { type AcpMessageBlock, type AcpUiEvent, reduceAcpEvents } from "@acp-ui/core/reduce";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AcpTranscript } from "./acp-transcript";
import { citationMarkdown, citationPresentation } from "./citations";

const source = {
  type: "resource_link",
  name: "Documentation",
  uri: "https://example.com/docs",
  _meta: { "bunny-agent/sourceId": "source" },
};
const contract = {
  schema_version: 1,
  offset_unit: "unicode-code-points",
  processing: "complete",
  annotations: [
    {
      type: "url_citation",
      start_index: 5,
      end_index: 8,
      url: "https://example.com/docs",
      title: "Documentation",
    },
  ],
  bindings: [
    {
      annotation_index: 0,
      source_id: "source",
      origin: "explicit_source_marker",
      tool_call_ids: [],
    },
  ],
};
const chunk = (content: unknown, metadata?: unknown): AcpUiEvent => ({
  type: "session_update",
  update: {
    sessionUpdate: "agent_message_chunk",
    messageId: "answer",
    content,
    ...(metadata
      ? {
          _meta: {
            "bunny-agent/providerMetadata": { "bunny-agent": { citation_contract: metadata } },
          },
        }
      : {}),
  } as never,
});
function answer(metadata: unknown = contract): AcpMessageBlock {
  return reduceAcpEvents(
    [],
    [
      chunk({ type: "text", text: "😀 中文 [1]" }),
      chunk(source),
      chunk({ type: "text", text: "" }, metadata),
    ],
  )[0] as AcpMessageBlock;
}

describe("citation contract adaptation", () => {
  it("preserves late metadata and converts code-point offsets without modifying canonical text", () => {
    const block = answer();
    expect(block.text).toBe("😀 中文 [1]");
    expect(block._meta).toHaveProperty("bunny-agent/providerMetadata");
    expect(block.content).toHaveLength(3);
    const presentation = citationPresentation(block);
    expect(presentation.kind).toBe("valid");
    expect(presentation.citations[0]).toMatchObject({
      start: 6,
      end: 9,
      quote: "[1]",
      sourceId: "source",
    });
    expect(citationMarkdown(block.text, presentation.citations)).toBe(
      "😀 中文 [\\[1\\]](<https://example.com/docs>)",
    );
    expect(block.text).toBe("😀 中文 [1]");
  });
  it("renders a bound inline source link after a serialized replay", () => {
    const replay = JSON.parse(JSON.stringify([answer()]));
    render(<AcpTranscript blocks={replay} onAnswerPermission={() => undefined} />);
    expect(screen.getByRole("button", { name: "[1]" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Documentation" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    expect(screen.getByTestId("acp-citations")).toHaveTextContent("Documentation");
    expect(screen.getByTestId("acp-citations").querySelector("li")).toHaveAttribute(
      "data-citation-start",
      "6",
    );
  });
  it("rejects unmatched, unsafe, overlapping and malformed citations", () => {
    expect(
      citationPresentation(
        answer({
          ...contract,
          annotations: [{ ...contract.annotations[0], url: "https://different.example/" }],
        }),
      ).kind,
    ).toBe("invalid");
    expect(
      citationPresentation(
        answer({
          ...contract,
          annotations: [{ ...contract.annotations[0], url: "javascript:alert(1)" }],
        }),
      ).kind,
    ).toBe("invalid");
    expect(
      citationPresentation(
        answer({ ...contract, annotations: [{ ...contract.annotations[0], end_index: 99 }] }),
      ).kind,
    ).toBe("invalid");
    expect(
      citationPresentation(
        answer({ ...contract, bindings: [contract.bindings[0], contract.bindings[0]] }),
      ).kind,
    ).toBe("invalid");
    expect(citationPresentation(answer({ ...contract, schema_version: 2 })).kind).toBe("absent");
    const block = answer();
    block.content?.push({ ...source, uri: "https://conflicting.example/" } as never);
    expect(citationPresentation(block).kind).toBe("invalid");
  });
  it("leaves code, existing links and spans across formatting unchanged", () => {
    const text = "`[1]` and **bold**";
    expect(
      citationMarkdown(text, [
        {
          start: 1,
          end: 4,
          url: "https://example.com/docs",
          title: "Code",
          sourceId: "source",
          quote: "[1]",
        },
      ]),
    ).toBe(text);
    const link = "[existing](https://existing.example)";
    expect(
      citationMarkdown(link, [
        {
          start: 1,
          end: 9,
          url: "https://example.com/docs",
          title: "Source",
          sourceId: "source",
          quote: "existing",
        },
      ]),
    ).toBe(link);
  });
  it("projects a citation into the correct interleaved text segment", () => {
    const metadata = {
      ...contract,
      annotations: [{ ...contract.annotations[0], start_index: 2, end_index: 3 }],
      bindings: [{ ...contract.bindings[0], origin: "provider" }],
    };
    const blocks = reduceAcpEvents(
      [],
      [
        chunk({ type: "text", text: "😀 " }),
        chunk({ type: "image", data: "eA==", mimeType: "image/png" }),
        chunk({ type: "text", text: "后" }),
        chunk(source),
        chunk({ type: "text", text: "" }, metadata),
      ],
    );
    render(<AcpTranscript blocks={blocks} onAnswerPermission={() => undefined} />);
    expect(screen.getByRole("button", { name: "后" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Documentation" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    expect(screen.getByRole("img")).toBeVisible();
  });
});
