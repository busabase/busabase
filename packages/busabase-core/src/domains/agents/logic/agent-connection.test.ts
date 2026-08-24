import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessions: [
    { id: "session-1", slug: "buda:agent-1" },
    { id: "session-2", slug: "codex-acp" },
  ],
  closeAgentSessions: vi.fn(),
  deleteSessionsBySlug: vi.fn(),
  disconnectBuda: vi.fn(),
}));

vi.mock("./agent-session-manager", () => ({
  closeAgentSessions: mocks.closeAgentSessions,
}));
vi.mock("./agent-session-store", () => ({
  loadSessions: async () => mocks.sessions,
  deleteSessionsBySlug: mocks.deleteSessionsBySlug,
}));
vi.mock("./buda-connection", () => ({
  disconnectBuda: mocks.disconnectBuda,
}));

import { disconnectAgentConnection } from "./agent-connection";

describe("disconnectAgentConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteSessionsBySlug.mockResolvedValue(1);
    mocks.disconnectBuda.mockResolvedValue(true);
  });

  it("closes sessions, revokes Buda, and deletes the scoped history", async () => {
    await expect(disconnectAgentConnection("buda:agent-1")).resolves.toEqual({
      ok: true,
      deletedSessionCount: 1,
    });

    expect(mocks.closeAgentSessions).toHaveBeenCalledWith(["session-1"]);
    expect(mocks.disconnectBuda).toHaveBeenCalledWith("buda:agent-1");
    expect(mocks.deleteSessionsBySlug).toHaveBeenCalledWith("buda:agent-1");
  });

  it("removes local-agent sessions without OAuth revocation", async () => {
    await disconnectAgentConnection("codex-acp");

    expect(mocks.closeAgentSessions).toHaveBeenCalledWith(["session-2"]);
    expect(mocks.disconnectBuda).not.toHaveBeenCalled();
    expect(mocks.deleteSessionsBySlug).toHaveBeenCalledWith("codex-acp");
  });

  it("rejects an unknown local connection", async () => {
    mocks.deleteSessionsBySlug.mockResolvedValue(0);

    await expect(disconnectAgentConnection("claude-acp")).rejects.toThrow(
      "Agent connection not found.",
    );
  });
});
