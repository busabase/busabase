import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failure: new Error("database unavailable"),
}));

vi.mock("../../../context", () => ({
  getContextActorId: () => "actor-1",
  getContextSpaceId: () => "space-1",
}));

vi.mock("../../../db", () => ({
  getDb: async () => {
    throw mocks.failure;
  },
}));

const { loadSessionEvents, loadSessions } = await import("./agent-session-store");

describe("agent session store read failures", () => {
  it("surfaces a session-list outage instead of reporting apparent data loss", async () => {
    await expect(loadSessions()).rejects.toThrow("database unavailable");
  });

  it("surfaces a transcript outage instead of reporting an empty conversation", async () => {
    await expect(loadSessionEvents("session-1", -1)).rejects.toThrow("database unavailable");
  });
});
