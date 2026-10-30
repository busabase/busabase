import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it, vi } from "vitest";
import { applyModelConfigSelection } from "./model-config-selection";

const input = { sessionId: "session", configId: "model", value: "reasoner", thinkingValue: "high" };
const confirmed: AgentSessionVO = {
  id: "session",
  slug: "agent",
  agentName: "Agent",
  transport: "remote-websocket",
  status: "idle",
  error: null,
  createdAt: "2026-10-28T00:00:00.000Z",
  lastActivityAt: "2026-10-28T00:00:00.000Z",
  modelOption: {
    id: "model",
    name: "Model",
    currentValue: "reasoner",
    options: [{ value: "reasoner", name: "Reasoner" }],
  },
  thinkingOption: {
    id: "confirmed-effort-id",
    name: "Thinking",
    currentValue: "medium",
    options: [
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
};

describe("applyModelConfigSelection", () => {
  it("waits for the model response and uses its confirmed thought config id", async () => {
    let release = (_session: AgentSessionVO) => {};
    const final = {
      ...confirmed,
      thinkingOption: { ...confirmed.thinkingOption!, currentValue: "high" },
    };
    const set = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<AgentSessionVO>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(final);
    const selection = applyModelConfigSelection(set, input);
    expect(set).toHaveBeenCalledExactlyOnceWith({
      sessionId: "session",
      configId: "model",
      value: "reasoner",
    });
    release(confirmed);
    await expect(selection).resolves.toEqual(final);
    expect(set).toHaveBeenNthCalledWith(2, {
      sessionId: "session",
      configId: "confirmed-effort-id",
      value: "high",
    });
  });

  it("does not send an effort request after a failed model switch", async () => {
    const set = vi.fn().mockRejectedValue(new Error("Switch failed"));
    await expect(applyModelConfigSelection(set, input)).rejects.toThrow("Switch failed");
    expect(set).toHaveBeenCalledOnce();
  });

  it.each([
    { ...confirmed, id: "other-session" },
    { ...confirmed, modelOption: { ...confirmed.modelOption!, currentValue: "other-model" } },
    { ...confirmed, thinkingOption: null },
    {
      ...confirmed,
      thinkingOption: {
        ...confirmed.thinkingOption!,
        options: [{ value: "medium", name: "Medium" }],
      },
    },
  ])(
    "rejects an unconfirmed or unsupported dependent level without sending another request",
    async (session) => {
      const set = vi.fn().mockResolvedValue(session);
      await expect(applyModelConfigSelection(set, input)).rejects.toThrow(
        /confirm|no longer offers/,
      );
      expect(set).toHaveBeenCalledOnce();
    },
  );

  it("avoids repeating an effort the model response already confirmed", async () => {
    const set = vi.fn().mockResolvedValue({
      ...confirmed,
      thinkingOption: { ...confirmed.thinkingOption!, currentValue: "high" },
    });
    await applyModelConfigSelection(set, input);
    expect(set).toHaveBeenCalledOnce();
  });

  it("keeps standalone thought changes as a single request", async () => {
    const set = vi.fn().mockResolvedValue(confirmed);
    await applyModelConfigSelection(set, {
      sessionId: "session",
      configId: "confirmed-effort-id",
      value: "high",
    });
    expect(set).toHaveBeenCalledExactlyOnceWith({
      sessionId: "session",
      configId: "confirmed-effort-id",
      value: "high",
    });
  });
});
