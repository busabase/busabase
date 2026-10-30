import { describe, expect, it, vi } from "vitest";
import { sendOrContinueAgentPrompt } from "./agent-session-continuation";

describe("sendOrContinueAgentPrompt", () => {
  it("carries the exact selected references through automatic continuation", async () => {
    const contextReferences = [{ nodeId: "node-selected-at-submit" }];
    const sendPrompt = vi
      .fn()
      .mockResolvedValueOnce({ accepted: false, promptRecorded: false, message: "ended" })
      .mockResolvedValueOnce({ accepted: true });
    await sendOrContinueAgentPrompt(
      { createSession: async () => ({ id: "new" }), sendPrompt },
      { sessionId: "old", status: "idle" },
      "agent",
      "unchanged text",
      undefined,
      undefined,
      contextReferences,
    );
    expect(sendPrompt).toHaveBeenNthCalledWith(
      1,
      "old",
      "unchanged text",
      undefined,
      undefined,
      contextReferences,
    );
    expect(sendPrompt).toHaveBeenNthCalledWith(
      2,
      "new",
      "unchanged text",
      undefined,
      undefined,
      contextReferences,
    );
  });
  it("sends straight to a reusable session without creating a new one", async () => {
    const createSession = vi.fn();
    const sendPrompt = vi.fn().mockResolvedValue({ accepted: true as const });
    const onSessionCreated = vi.fn();

    const result = await sendOrContinueAgentPrompt(
      { createSession, sendPrompt, onSessionCreated },
      { sessionId: "s1", status: "idle" },
      "claude",
      "hello",
    );

    expect(result).toEqual({ outcome: "reused", sessionId: "s1" });
    expect(sendPrompt).toHaveBeenCalledWith("s1", "hello", undefined, undefined, undefined);
    expect(createSession).not.toHaveBeenCalled();
    expect(onSessionCreated).not.toHaveBeenCalled();
  });

  it.each(["connecting", "busy", "waiting_permission"] as const)(
    "delegates a %s status to the existing-session send path",
    async (status) => {
      const createSession = vi.fn();
      const sendPrompt = vi.fn().mockResolvedValue({ accepted: true as const });

      const result = await sendOrContinueAgentPrompt(
        { createSession, sendPrompt },
        { sessionId: "s1", status },
        "claude",
        "hello",
      );

      expect(result).toEqual({ outcome: "reused", sessionId: "s1" });
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it.each(["ended", "failed"] as const)(
    "transparently continues into a new session when the active one is %s",
    async (status) => {
      const createSession = vi.fn().mockResolvedValue({ id: "s2" });
      const sendPrompt = vi.fn().mockResolvedValue({ accepted: true as const });
      const onSessionCreated = vi.fn();

      const result = await sendOrContinueAgentPrompt(
        { createSession, sendPrompt, onSessionCreated },
        { sessionId: "s1", status },
        "claude",
        "keep going",
      );

      expect(result).toEqual({ outcome: "continued", sessionId: "s2" });
      expect(createSession).toHaveBeenCalledWith("claude");
      expect(sendPrompt).toHaveBeenCalledWith("s2", "keep going", undefined, undefined, undefined);
    },
  );

  it("creates a session the same way when there is no active session at all", async () => {
    const createSession = vi.fn().mockResolvedValue({ id: "s2" });
    const sendPrompt = vi.fn().mockResolvedValue({ accepted: true as const });

    const result = await sendOrContinueAgentPrompt(
      { createSession, sendPrompt },
      null,
      "claude",
      "first message",
    );

    expect(result).toEqual({ outcome: "continued", sessionId: "s2" });
  });

  it("selects the new session before the prompt resolves, not after", async () => {
    const createSession = vi.fn().mockResolvedValue({ id: "s2" });
    const order: string[] = [];
    const onSessionCreated = vi.fn(() => {
      order.push("selected");
    });
    const sendPrompt = vi.fn().mockImplementation(async () => {
      order.push("sent");
      return { accepted: true as const };
    });

    await sendOrContinueAgentPrompt(
      { createSession, sendPrompt, onSessionCreated },
      { sessionId: "s1", status: "failed" },
      "claude",
      "keep going",
    );

    expect(order).toEqual(["selected", "sent"]);
  });

  it("waits for the new session to become visible before sending its prompt", async () => {
    const createSession = vi.fn().mockResolvedValue({ id: "s2" });
    const order: string[] = [];
    const onSessionCreated = vi.fn(async () => {
      await Promise.resolve();
      order.push("session-visible");
    });
    const sendPrompt = vi.fn().mockImplementation(async () => {
      order.push("sent");
      return { accepted: true as const };
    });

    await sendOrContinueAgentPrompt(
      { createSession, sendPrompt, onSessionCreated },
      { sessionId: "s1", status: "failed" },
      "claude",
      "keep going",
    );

    expect(order).toEqual(["session-visible", "sent"]);
  });

  it("passes attachments through to the new session's prompt", async () => {
    const createSession = vi.fn().mockResolvedValue({ id: "s2" });
    const sendPrompt = vi.fn().mockResolvedValue({ accepted: true as const });
    const attachments = [{ kind: "image" as const, data: "YQ==", mimeType: "image/png" }];

    await sendOrContinueAgentPrompt(
      { createSession, sendPrompt },
      { sessionId: "s1", status: "ended" },
      "claude",
      "look at this",
      attachments,
    );

    expect(sendPrompt).toHaveBeenCalledWith(
      "s2",
      "look at this",
      attachments,
      undefined,
      undefined,
    );
  });

  it.each(["idle", "ended", "failed"] as const)(
    "preserves display provenance and attachments when sending from a %s session",
    async (status) => {
      const createSession = vi.fn().mockResolvedValue({ id: "s2" });
      const sendPrompt = vi.fn().mockResolvedValue({ accepted: true as const });
      const presentation = { version: 1 as const, source: "node-context" as const, text: "" };
      const attachments = [{ kind: "image" as const, data: "YQ==", mimeType: "image/png" }];

      await sendOrContinueAgentPrompt(
        { createSession, sendPrompt },
        { sessionId: "s1", status },
        "claude",
        "Official node context",
        attachments,
        presentation,
      );

      expect(sendPrompt).toHaveBeenCalledWith(
        status === "idle" ? "s1" : "s2",
        "Official node context",
        attachments,
        presentation,
        undefined,
      );
    },
  );

  it("propagates a session-creation failure without attempting to send", async () => {
    const createSession = vi.fn().mockRejectedValue(new Error("no agent binary on PATH"));
    const sendPrompt = vi.fn();

    await expect(
      sendOrContinueAgentPrompt(
        { createSession, sendPrompt },
        { sessionId: "s1", status: "failed" },
        "claude",
        "keep going",
      ),
    ).rejects.toThrow("no agent binary on PATH");
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("propagates a send failure on the freshly created session", async () => {
    const createSession = vi.fn().mockResolvedValue({ id: "s2" });
    const sendPrompt = vi.fn().mockRejectedValue(new Error("ACP connection closed"));

    await expect(
      sendOrContinueAgentPrompt(
        { createSession, sendPrompt },
        { sessionId: "s1", status: "ended" },
        "claude",
        "keep going",
      ),
    ).rejects.toThrow("ACP connection closed");
  });

  it("continues when a session became terminal after render but before send", async () => {
    const createSession = vi.fn().mockResolvedValue({ id: "s2" });
    const sendPrompt = vi
      .fn()
      .mockResolvedValueOnce({
        accepted: false as const,
        promptRecorded: false,
        message: "ACP connection closed",
      })
      .mockResolvedValueOnce({ accepted: true as const });

    const result = await sendOrContinueAgentPrompt(
      { createSession, sendPrompt },
      { sessionId: "s1", status: "idle" },
      "claude",
      "don't disappear",
    );

    expect(result).toEqual({ outcome: "continued", sessionId: "s2" });
    expect(sendPrompt).toHaveBeenNthCalledWith(
      1,
      "s1",
      "don't disappear",
      undefined,
      undefined,
      undefined,
    );
    expect(sendPrompt).toHaveBeenNthCalledWith(
      2,
      "s2",
      "don't disappear",
      undefined,
      undefined,
      undefined,
    );
  });

  it("does not retry when the terminal transition happened after the prompt was recorded", async () => {
    const createSession = vi.fn();
    const sendPrompt = vi.fn().mockResolvedValue({
      accepted: false as const,
      promptRecorded: true,
      message: "ACP connection closed",
    });

    await expect(
      sendOrContinueAgentPrompt(
        { createSession, sendPrompt },
        { sessionId: "s1", status: "idle" },
        "claude",
        "record this once",
      ),
    ).rejects.toThrow("ACP connection closed");
    expect(createSession).not.toHaveBeenCalled();
    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });
});

describe("structured resource continuation", () => {
  const resourceContext = [
    {
      id: "one",
      name: "Review · Report",
      uri: "busabase-agent-prompt:///one",
      mimeType: "text/plain" as const,
      text: "Target report.\n\nRead all records. 🌏",
      metadata: {
        "busabase.agentPrompt": {
          version: 1 as const,
          kind: "busabase-agent-prompt" as const,
          scenario: { id: "review", title: "Review" },
          target: { nodeId: "node", nodeName: "Report", nodeType: "base" },
          source: { origin: "https://busabase.example", edition: "desktop" as const },
          segments: [
            { kind: "target" as const, text: "Target report." },
            { kind: "task" as const, text: "Read all records. 🌏" },
          ],
        },
      },
    },
  ];
  const attachments = [{ kind: "image" as const, data: "YQ==", mimeType: "image/png" }];

  it.each(["idle", "ended", "failed"] as const)(
    "preserves complete explicit context-only resources from a %s session",
    async (status) => {
      const createSession = vi.fn().mockResolvedValue({ id: "new" });
      const sendPrompt = vi.fn().mockResolvedValue({ accepted: true });
      await sendOrContinueAgentPrompt(
        { createSession, sendPrompt },
        { sessionId: "old", status },
        "agent",
        "",
        undefined,
        undefined,
        undefined,
        resourceContext,
      );
      expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(
        status === "idle" ? "old" : "new",
        "",
        undefined,
        undefined,
        undefined,
        resourceContext,
      );
      expect(sendPrompt.mock.calls[0][5]).toBe(resourceContext);
    },
  );

  it("retains context order, typed instructions and files when an unrecorded send continues", async () => {
    const ordered = [
      ...resourceContext,
      { ...resourceContext[0], id: "two", uri: "busabase-agent-prompt:///two" },
    ];
    const sendPrompt = vi
      .fn()
      .mockResolvedValueOnce({ accepted: false, promptRecorded: false, message: "ended" })
      .mockResolvedValueOnce({ accepted: true });
    await sendOrContinueAgentPrompt(
      { createSession: async () => ({ id: "new" }), sendPrompt },
      { sessionId: "old", status: "idle" },
      "agent",
      "Focus on today's records.",
      attachments,
      undefined,
      undefined,
      ordered,
    );
    expect(sendPrompt).toHaveBeenNthCalledWith(
      1,
      "old",
      "Focus on today's records.",
      attachments,
      undefined,
      undefined,
      ordered,
    );
    expect(sendPrompt).toHaveBeenNthCalledWith(
      2,
      "new",
      "Focus on today's records.",
      attachments,
      undefined,
      undefined,
      ordered,
    );
  });

  it("never replays already-recorded resources after terminal rejection", async () => {
    const createSession = vi.fn();
    const sendPrompt = vi.fn().mockResolvedValue({
      accepted: false,
      promptRecorded: true,
      message: "closed after recording",
    });
    await expect(
      sendOrContinueAgentPrompt(
        { createSession, sendPrompt },
        { sessionId: "old", status: "idle" },
        "agent",
        "",
        undefined,
        undefined,
        undefined,
        resourceContext,
      ),
    ).rejects.toThrow("closed after recording");
    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(
      "old",
      "",
      undefined,
      undefined,
      undefined,
      resourceContext,
    );
    expect(createSession).not.toHaveBeenCalled();
  });
});
