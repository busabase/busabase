import { describe, expect, it } from "vitest";
import { foldSessionTitle, foldUsage, sessionTitleOf, usageOf } from "./session-info";
import type { AcpUiEvent } from "./types";

const usageUpdate = (used: number, extra: Record<string, unknown> = {}): AcpUiEvent => ({
  type: "session_update",
  update: { sessionUpdate: "usage_update", used, size: 1_000_000, ...extra } as never,
});

const sessionInfoUpdate = (fields: Record<string, unknown>): AcpUiEvent => ({
  type: "session_update",
  update: { sessionUpdate: "session_info_update", ...fields } as never,
});

const messageChunk: AcpUiEvent = {
  type: "session_update",
  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } as never,
};

describe("usageOf", () => {
  // Real payload observed from an actual claude-agent-acp session.
  it("extracts used/size/cost from a real-shaped usage_update", () => {
    const event = usageUpdate(27277, { cost: { amount: 0.387948, currency: "USD" } });
    expect(usageOf(event)).toEqual({
      used: 27277,
      size: 1_000_000,
      cost: { amount: 0.387948, currency: "USD" },
    });
  });

  it("omits cost when the agent didn't report one", () => {
    expect(usageOf(usageUpdate(100))).toEqual({ used: 100, size: 1_000_000 });
  });

  it("is null for anything other than usage_update", () => {
    expect(usageOf(messageChunk)).toBeNull();
  });

  it("is null for a non-session_update event", () => {
    expect(usageOf({ type: "note", text: "hi" })).toBeNull();
  });
});

describe("foldUsage", () => {
  it("keeps the most recent usage across a batch", () => {
    expect(foldUsage([usageUpdate(100), usageUpdate(200), usageUpdate(300)])).toEqual({
      used: 300,
      size: 1_000_000,
    });
  });

  it("ignores non-usage events interleaved with usage ones", () => {
    expect(foldUsage([usageUpdate(100), messageChunk, usageUpdate(200)])?.used).toBe(200);
  });

  it("is null for a batch with no usage_update at all", () => {
    expect(foldUsage([messageChunk])).toBeNull();
  });

  it("is null for an empty batch", () => {
    expect(foldUsage([])).toBeNull();
  });
});

describe("sessionTitleOf", () => {
  // Real payload: Claude auto-titles the conversation from its content.
  it("extracts a real-shaped title", () => {
    expect(
      sessionTitleOf(
        sessionInfoUpdate({ title: "Composer smoke test", updatedAt: "2026-08-19T11:26:46.750Z" }),
      ),
    ).toBe("Composer smoke test");
  });

  // ACP's own schema: "Set to null to clear."
  it("returns null (not undefined) when the agent explicitly clears the title", () => {
    expect(sessionTitleOf(sessionInfoUpdate({ title: null }))).toBeNull();
  });

  // Distinct from "explicitly cleared": this update didn't mention title at all.
  it("returns undefined when a session_info_update omits title entirely", () => {
    expect(
      sessionTitleOf(sessionInfoUpdate({ updatedAt: "2026-08-19T11:26:46.750Z" })),
    ).toBeUndefined();
  });

  it("is undefined for anything other than session_info_update", () => {
    expect(sessionTitleOf(messageChunk)).toBeUndefined();
  });
});

describe("foldSessionTitle", () => {
  it("keeps the most recent title across a batch", () => {
    expect(
      foldSessionTitle([
        sessionInfoUpdate({ title: "first" }),
        sessionInfoUpdate({ title: "second" }),
      ]),
    ).toBe("second");
  });

  // An update that omits title must not erase a title set earlier — this is
  // exactly what the undefined/null distinction in sessionTitleOf is for.
  it("does not let a title-less update erase an earlier title", () => {
    expect(
      foldSessionTitle([
        sessionInfoUpdate({ title: "first" }),
        sessionInfoUpdate({ updatedAt: "2026-08-19T11:26:46.750Z" }),
      ]),
    ).toBe("first");
  });

  it("an explicit clear does erase an earlier title", () => {
    expect(
      foldSessionTitle([sessionInfoUpdate({ title: "first" }), sessionInfoUpdate({ title: null })]),
    ).toBeNull();
  });

  it("is null for a batch with no session_info_update at all", () => {
    expect(foldSessionTitle([messageChunk])).toBeNull();
  });
});
