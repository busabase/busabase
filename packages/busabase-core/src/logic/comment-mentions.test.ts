import { describe, expect, it } from "vitest";
import {
  applyMentionPick,
  buildMentionPrompt,
  CommentMentionValidationError,
  type DraftCommentMention,
  findMentionQuery,
  hasAgentMention,
  MENTION_ERROR_MAX_LENGTH,
  mentionSpansFromLabels,
  normalizeCommentMentions,
  reanchorMentions,
  splitsSurrogatePair,
  trimmedSubmission,
  truncateMentionError,
} from "./comment-mentions";

const span = (type: "member" | "agent", id: string, start: number, end: number) => ({
  type,
  id,
  start,
  end,
});

/** Reason of the thrown validation error, or `null` when nothing was thrown. */
const reasonOf = (body: string, mentions: Parameters<typeof normalizeCommentMentions>[1]) => {
  try {
    normalizeCommentMentions(body, mentions);
    return null;
  } catch (error) {
    if (error instanceof CommentMentionValidationError) return error.reason;
    throw error;
  }
};

describe("normalizeCommentMentions — bounds", () => {
  it("accepts a span that exactly covers the label", () => {
    const body = "hey @Alice look";
    expect(normalizeCommentMentions(body, [span("member", "u1", 4, 10)])).toEqual([
      { type: "member", targetId: "u1", start: 4, end: 10 },
    ]);
    expect(body.slice(4, 10)).toBe("@Alice");
  });

  it("rejects a span that runs past the end of the body", () => {
    expect(reasonOf("short", [span("member", "u1", 0, 99)])).toBe("out_of_bounds");
  });

  it("rejects a negative start", () => {
    expect(reasonOf("hello", [span("member", "u1", -1, 3)])).toBe("out_of_bounds");
  });

  it("rejects a non-integer offset", () => {
    expect(reasonOf("hello", [span("member", "u1", 0.5, 3)])).toBe("out_of_bounds");
  });

  it("rejects an empty span", () => {
    expect(reasonOf("hello", [span("member", "u1", 2, 2)])).toBe("empty_span");
  });

  it("rejects an empty target id", () => {
    expect(reasonOf("hello", [span("member", "   ", 0, 3)])).toBe("empty_target");
  });
});

describe("normalizeCommentMentions — overlap", () => {
  it("rejects two spans that overlap", () => {
    const body = "@Alice@Bob";
    expect(reasonOf(body, [span("member", "u1", 0, 7), span("member", "u2", 6, 10)])).toBe(
      "overlapping",
    );
  });

  it("accepts two spans that merely touch", () => {
    const body = "@Alice@Bob";
    expect(
      normalizeCommentMentions(body, [span("member", "u1", 0, 6), span("member", "u2", 6, 10)]),
    ).toHaveLength(2);
  });

  it("sorts before checking, so an out-of-order pair is still validated", () => {
    const body = "@Alice@Bob";
    expect(reasonOf(body, [span("member", "u2", 6, 10), span("member", "u1", 0, 7)])).toBe(
      "overlapping",
    );
  });
});

describe("normalizeCommentMentions — surrogate pairs", () => {
  // "🎉" is a single astral code point occupying TWO UTF-16 code units.
  const body = "看这里 🎉 @Alice 结尾";

  it("splitsSurrogatePair flags an index between the two halves", () => {
    const emojiStart = body.indexOf("🎉");
    expect(splitsSurrogatePair(body, emojiStart)).toBe(false);
    expect(splitsSurrogatePair(body, emojiStart + 1)).toBe(true);
    expect(splitsSurrogatePair(body, emojiStart + 2)).toBe(false);
  });

  it("rejects a span whose start cuts a surrogate pair in half", () => {
    const emojiStart = body.indexOf("🎉");
    expect(reasonOf(body, [span("member", "u1", emojiStart + 1, emojiStart + 4)])).toBe(
      "splits_surrogate_pair",
    );
  });

  it("rejects a span whose end cuts a surrogate pair in half", () => {
    const emojiStart = body.indexOf("🎉");
    expect(reasonOf(body, [span("member", "u1", 0, emojiStart + 1)])).toBe("splits_surrogate_pair");
  });

  it("accepts a mention that sits after an emoji, with CJK on both sides", () => {
    const start = body.indexOf("@Alice");
    const result = normalizeCommentMentions(body, [span("member", "u1", start, start + 6)]);
    expect(result).toEqual([{ type: "member", targetId: "u1", start, end: start + 6 }]);
    expect(body.slice(start, start + 6)).toBe("@Alice");
  });

  it("treats plain CJK as single code units (no false positives)", () => {
    const cjk = "论点很扎实 @Codex 请复核";
    const start = cjk.indexOf("@Codex");
    expect(splitsSurrogatePair(cjk, start)).toBe(false);
    expect(normalizeCommentMentions(cjk, [span("agent", "codex-acp", start, start + 6)])).toEqual([
      { type: "agent", targetId: "codex-acp", start, end: start + 6 },
    ]);
  });
});

describe("normalizeCommentMentions — duplicates", () => {
  it("keeps BOTH occurrences when the same member is mentioned twice", () => {
    // "@Alice see the top — and @Alice the footer too" is legitimate writing and
    // each occurrence needs its own row so both chips render.
    const body = "@Alice top and @Alice footer";
    const result = normalizeCommentMentions(body, [
      span("member", "u1", 0, 6),
      span("member", "u1", 15, 21),
    ]);
    expect(result).toEqual([
      { type: "member", targetId: "u1", start: 0, end: 6 },
      { type: "member", targetId: "u1", start: 15, end: 21 },
    ]);
  });

  it("collapses a repeated agent to its FIRST occurrence (one session, not two)", () => {
    const body = "@Codex here and @Codex there";
    const result = normalizeCommentMentions(body, [
      span("agent", "codex-acp", 0, 6),
      span("agent", "codex-acp", 16, 22),
    ]);
    expect(result).toEqual([{ type: "agent", targetId: "codex-acp", start: 0, end: 6 }]);
  });

  it("keeps two DIFFERENT agents", () => {
    const body = "@Codex and @Claude";
    const result = normalizeCommentMentions(body, [
      span("agent", "codex-acp", 0, 6),
      span("agent", "claude-acp", 11, 18),
    ]);
    expect(result.map((m) => m.targetId)).toEqual(["codex-acp", "claude-acp"]);
  });

  it("still validates a duplicate agent's span before collapsing it", () => {
    expect(
      reasonOf("@Codex", [span("agent", "codex-acp", 0, 6), span("agent", "codex-acp", 0, 999)]),
    ).toBe("out_of_bounds");
  });
});

describe("hasAgentMention", () => {
  it("is false for members only, true as soon as one agent appears", () => {
    expect(hasAgentMention([{ type: "member" }, { type: "member" }])).toBe(false);
    expect(hasAgentMention([{ type: "member" }, { type: "agent" }])).toBe(true);
    expect(hasAgentMention([])).toBe(false);
  });
});

describe("truncateMentionError", () => {
  it("leaves a short message alone", () => {
    expect(truncateMentionError("boom")).toBe("boom");
  });

  it("bounds a long one visibly", () => {
    const long = "x".repeat(MENTION_ERROR_MAX_LENGTH + 200);
    const truncated = truncateMentionError(long);
    expect(truncated).toHaveLength(MENTION_ERROR_MAX_LENGTH);
    expect(truncated.endsWith("…")).toBe(true);
  });
});

describe("mentionSpansFromLabels", () => {
  it("derives spans for CJK fixture text without hand-counted offsets", () => {
    const body = "合并护栏这一节。@演示 Agent 请复核，@local-editor 之后也看一下。";
    const spans = mentionSpansFromLabels(body, [
      { type: "agent" as const, text: "@演示 Agent" },
      { type: "member" as const, text: "@local-editor" },
    ]);
    expect(body.slice(spans[0].start, spans[0].end)).toBe("@演示 Agent");
    expect(body.slice(spans[1].start, spans[1].end)).toBe("@local-editor");
    expect(spans[0].end).toBeLessThanOrEqual(spans[1].start);
  });

  it("resolves a repeated label to successive occurrences", () => {
    const body = "@Alice one @Alice two";
    const spans = mentionSpansFromLabels(body, [
      { type: "member" as const, text: "@Alice" },
      { type: "member" as const, text: "@Alice" },
    ]);
    expect(spans.map((s) => s.start)).toEqual([0, 11]);
  });

  it("throws when the text is not in the body, rather than inventing a span", () => {
    expect(() =>
      mentionSpansFromLabels("no mention here", [{ type: "member" as const, text: "@Ghost" }]),
    ).toThrow();
  });
});

describe("findMentionQuery", () => {
  it("opens on `@` at the start of the body", () => {
    expect(findMentionQuery("@cod", 4)).toEqual({ start: 0, query: "cod" });
  });

  it("opens on `@` after whitespace", () => {
    expect(findMentionQuery("please ask @cod", 15)).toEqual({ start: 11, query: "cod" });
  });

  it("does NOT open inside an email address", () => {
    expect(findMentionQuery("ping a@b.com", 12)).toBeNull();
  });

  it("closes once the query crosses a newline", () => {
    expect(findMentionQuery("@cod\nnext", 9)).toBeNull();
  });
});

describe("reanchorMentions", () => {
  const alice = { type: "member" as const, id: "u1", label: "@Alice", start: 4, end: 10 };

  it("keeps a mention untouched when nothing before it changed", () => {
    expect(reanchorMentions("hey @Alice look", [alice])).toEqual([alice]);
  });

  it("shifts a mention when text is inserted before it", () => {
    const [moved] = reanchorMentions("hey!! @Alice look", [alice]);
    expect(moved.start).toBe(6);
    expect(moved.end).toBe(12);
  });

  it("drops a mention the user edited through", () => {
    expect(reanchorMentions("hey @Alic look", [alice])).toEqual([]);
  });

  it("survives a body containing an emoji before the mention", () => {
    const body = "🎉 @Alice";
    const start = body.indexOf("@Alice");
    const [moved] = reanchorMentions(body, [alice]);
    expect(moved.start).toBe(start);
    expect(body.slice(moved.start, moved.end)).toBe("@Alice");
    expect(splitsSurrogatePair(body, moved.start)).toBe(false);
  });
});

describe("applyMentionPick", () => {
  it("replaces the in-progress query with the chip and records its span", () => {
    const result = applyMentionPick(
      "please ask @cod",
      [] as DraftCommentMention[],
      { start: 11, query: "cod" },
      {
        type: "agent",
        id: "codex-acp",
        label: "Codex",
      },
    );
    expect(result.body).toBe("please ask @Codex ");
    expect(result.caret).toBe(result.body.length);
    expect(result.mentions).toEqual([
      { type: "agent", id: "codex-acp", label: "@Codex", start: 11, end: 17 },
    ]);
    expect(result.body.slice(11, 17)).toBe("@Codex");
  });

  it("keeps earlier mentions anchored when a later one is inserted", () => {
    const empty: DraftCommentMention[] = [];
    const first = applyMentionPick(
      "@al",
      empty,
      { start: 0, query: "al" },
      {
        type: "member",
        id: "u1",
        label: "Alice",
      },
    );
    const second = applyMentionPick(
      `${first.body}and @co`,
      first.mentions,
      { start: first.body.length + 4, query: "co" },
      { type: "agent", id: "codex-acp", label: "Codex" },
    );
    expect(second.mentions).toHaveLength(2);
    for (const mention of second.mentions) {
      expect(second.body.slice(mention.start, mention.end)).toBe(mention.label);
    }
  });
});

describe("trimmedSubmission", () => {
  it("shifts spans by the leading whitespace the server will strip", () => {
    const body = "   @Alice hi   ";
    const mentions = [{ type: "member" as const, id: "u1", label: "@Alice", start: 3, end: 9 }];
    const submission = trimmedSubmission(body, mentions);
    expect(submission.body).toBe("@Alice hi");
    expect(submission.mentions).toEqual([{ type: "member", id: "u1", start: 0, end: 6 }]);
    // The shifted span must still validate against the body that gets stored.
    expect(normalizeCommentMentions(submission.body, submission.mentions)).toEqual([
      { type: "member", targetId: "u1", start: 0, end: 6 },
    ]);
  });

  it("drops the composer-only label from what is sent", () => {
    const submission = trimmedSubmission("@Alice", [
      { type: "member", id: "u1", label: "@Alice", start: 0, end: 6 },
    ]);
    expect(submission.mentions[0]).not.toHaveProperty("label");
  });
});

describe("buildMentionPrompt", () => {
  const subject = {
    kind: "Change Request",
    id: "crq_1",
    title: "Tighten the launch claim",
    context: "- record_update on rec_1",
  };

  it("names the subject, the author and the comment — not just the comment text", () => {
    const prompt = buildMentionPrompt({
      subject,
      authorLabel: "Alice",
      body: "fix the null check on line 40",
    });
    expect(prompt).toContain('Change Request "Tighten the launch claim" (crq_1)');
    expect(prompt).toContain("Comment from Alice:");
    expect(prompt).toContain("fix the null check on line 40");
    expect(prompt).toContain("- record_update on rec_1");
  });

  it("omits the context block entirely when there is nothing to show", () => {
    const prompt = buildMentionPrompt({
      subject: { ...subject, context: "" },
      authorLabel: "Alice",
      body: "have a look",
    });
    expect(prompt).not.toContain("contents:");
  });
});
