import { describe, expect, it } from "vitest";
import {
  AGENT_PROMPT_CONTEXT_LIMITS,
  AgentPromptEnvelopeSchema,
  createAgentPromptEnvelope,
  createPromptResourceContext,
  decodeAgentPromptClipboard,
  joinAgentPromptSegments,
  PromptResourceContextInputSchema,
  PromptResourceContextListSchema,
} from "./prompt-context";
import { PromptAgentSessionInputSchema } from "./types";

const source = {
  origin: "https://busabase.example",
  edition: "cloud" as const,
  spaceId: "spc_one",
};
const makeEnvelope = () =>
  createAgentPromptEnvelope({
    scenario: { id: "custom:review", title: "审阅 🌏" },
    target: { nodeId: "nod_one", nodeName: "运营目标", nodeType: "base" },
    source,
    segments: [
      { kind: "target", text: "Target: 运营目标" },
      { kind: "task", text: "保留空格  \n以及换行 🌏" },
      { kind: "footer", text: "Reply in Chinese." },
      { kind: "connection", text: "Use https://busabase.example/SETUP_SKILL.md" },
    ],
  });

describe("Agent prompt envelope", () => {
  it("round-trips every complete segment and Unicode without normalization", () => {
    const envelope = makeEnvelope();
    const text = joinAgentPromptSegments(envelope.segments);
    const context = decodeAgentPromptClipboard(
      JSON.stringify(envelope),
      text,
      source,
      "insertion-one",
    );
    expect(context).toEqual(createPromptResourceContext(envelope, "insertion-one"));
    expect(context?.text).toBe(
      "Target: 运营目标\n\n保留空格  \n以及换行 🌏\n\nReply in Chinese.\n\nUse https://busabase.example/SETUP_SKILL.md",
    );
  });

  it.each(["base-find", "custom:my-scenario"])(
    "accepts built-in/custom %s with no footer or connection",
    (id) => {
      const envelope = makeEnvelope();
      envelope.scenario.id = id;
      envelope.segments = [{ kind: "task", text: "Complete task." }];
      expect(
        decodeAgentPromptClipboard(JSON.stringify(envelope), "Complete task.", source, "id")?.text,
      ).toBe("Complete task.");
    },
  );

  it.each([
    { version: 2 },
    { kind: "other" },
    { target: {} },
    { segments: [] },
    { segments: [{ kind: "unknown", text: "task" }] },
    { segments: Array.from({ length: 5 }, () => ({ kind: "task", text: "task" })) },
    { scenario: { id: "x".repeat(257), title: "title" } },
    { target: { nodeId: "id", nodeName: "x".repeat(513), nodeType: "base" } },
    { source: { ...source, spaceId: undefined } },
    { source: { ...source, origin: "https://busabase.example/path" } },
  ])("rejects unsupported or malformed envelope %j", (changes) => {
    const envelope = { ...makeEnvelope(), ...changes };
    expect(AgentPromptEnvelopeSchema.safeParse(envelope).success).toBe(false);
    expect(decodeAgentPromptClipboard(JSON.stringify(envelope), "task", source, "id")).toBeNull();
  });

  it.each(["", "{", "[]", "null"])("ignores invalid clipboard JSON %s", (serialized) => {
    expect(decodeAgentPromptClipboard(serialized, "task", source, "id")).toBeNull();
  });

  it("enforces serialized UTF-8 envelope bounds, including multibyte content", () => {
    const envelope = makeEnvelope();
    envelope.segments = [
      {
        kind: "task",
        text: "中".repeat(Math.ceil(AGENT_PROMPT_CONTEXT_LIMITS.maxEnvelopeBytes / 3)),
      },
    ];
    expect(AgentPromptEnvelopeSchema.safeParse(envelope).success).toBe(false);
    expect(
      decodeAgentPromptClipboard(JSON.stringify(envelope), envelope.segments[0].text, source, "id"),
    ).toBeNull();
  });

  it.each([
    (text: string) => `${text} `,
    (text: string) => text.replaceAll("\n", "\r\n"),
    (text: string) => text.replace("  ", " "),
    (text: string) => text.replace("\n\n", "\n"),
  ])("keeps full-text fallback on any whitespace/newline mismatch", (change) => {
    const envelope = makeEnvelope();
    const text = change(joinAgentPromptSegments(envelope.segments));
    expect(decodeAgentPromptClipboard(JSON.stringify(envelope), text, source, "id")).toBeNull();
    expect(
      PromptResourceContextInputSchema.safeParse({
        ...createPromptResourceContext(envelope, "id"),
        text,
      }).success,
    ).toBe(false);
  });

  it.each([
    { ...source, origin: "https://another.example" },
    { ...source, edition: "desktop" as const },
    { ...source, spaceId: "spc_two" },
    { ...source, spaceId: undefined },
  ])("rejects incompatible destination %j", (destination) => {
    const envelope = makeEnvelope();
    expect(
      decodeAgentPromptClipboard(
        JSON.stringify(envelope),
        joinAgentPromptSegments(envelope.segments),
        destination,
        "id",
      ),
    ).toBeNull();
  });

  it("supports Desktop without a Cloud space and gives each explicit insertion a unique URI", () => {
    const envelope = makeEnvelope();
    envelope.source = { origin: source.origin, edition: "desktop" };
    const text = joinAgentPromptSegments(envelope.segments);
    const first = decodeAgentPromptClipboard(
      JSON.stringify(envelope),
      text,
      envelope.source,
      "one/a",
    );
    const second = decodeAgentPromptClipboard(
      JSON.stringify(envelope),
      text,
      envelope.source,
      "two",
    );
    expect(first?.uri).toBe("busabase-agent-prompt:///one%2Fa");
    expect(first?.uri).not.toBe(second?.uri);
  });

  it("accepts context-only requests while preserving old text/file/context-reference inputs", () => {
    const context = createPromptResourceContext(makeEnvelope(), "id");
    expect(
      PromptAgentSessionInputSchema.safeParse({
        sessionId: "s",
        text: "",
        resourceContext: [context],
      }).success,
    ).toBe(true);
    expect(PromptAgentSessionInputSchema.safeParse({ sessionId: "s", text: "" }).success).toBe(
      false,
    );
    expect(PromptAgentSessionInputSchema.safeParse({ sessionId: "s", text: "hello" }).success).toBe(
      true,
    );
    expect(
      PromptAgentSessionInputSchema.safeParse({
        sessionId: "s",
        text: "",
        contextReferences: [{ nodeId: "n" }],
      }).success,
    ).toBe(true);
    expect(
      PromptAgentSessionInputSchema.safeParse({
        sessionId: "s",
        text: "",
        attachments: [{ kind: "file", mimeType: "text/plain", data: "eA==" }],
      }).success,
    ).toBe(true);
  });

  it("enforces both count and aggregate context text limits", () => {
    const envelope = makeEnvelope();
    envelope.segments = [{ kind: "task", text: "x".repeat(750_000) }];
    const context = createPromptResourceContext(envelope, "id");
    expect(PromptResourceContextListSchema.safeParse([context, context]).success).toBe(true);
    expect(PromptResourceContextListSchema.safeParse([context, context, context]).success).toBe(
      false,
    );
    const small = createPromptResourceContext(makeEnvelope(), "small");
    expect(PromptResourceContextListSchema.safeParse(Array(21).fill(small)).success).toBe(false);
  });
});
