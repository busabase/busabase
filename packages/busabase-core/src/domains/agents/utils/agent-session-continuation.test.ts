import { describe, expect, it, vi } from "vitest";
import { sendOrContinueAgentPrompt } from "./agent-session-continuation";

describe("sendOrContinueAgentPrompt", () => {
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
    expect(sendPrompt).toHaveBeenCalledWith("s1", "hello", undefined);
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
      expect(sendPrompt).toHaveBeenCalledWith("s2", "keep going", undefined);
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

    expect(sendPrompt).toHaveBeenCalledWith("s2", "look at this", attachments);
  });

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
    expect(sendPrompt).toHaveBeenNthCalledWith(1, "s1", "don't disappear", undefined);
    expect(sendPrompt).toHaveBeenNthCalledWith(2, "s2", "don't disappear", undefined);
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
