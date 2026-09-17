import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessions: [
    { id: "session-1", slug: "buda:agent-1" },
    { id: "session-2", slug: "codex-acp" },
  ],
  closeAgentSessions: vi.fn(),
  listLiveAgentSessionIds: vi.fn(),
  deleteSessionsBySlug: vi.fn(),
  endSessionsBySlug: vi.fn(),
  normalizeLegacyBudaSessions: vi.fn(),
  disconnectBuda: vi.fn(),
  getOwnedBudaConnectionIdentity: vi.fn(),
}));

vi.mock("./agent-session-manager", () => ({
  closeAgentSessions: mocks.closeAgentSessions,
  listLiveAgentSessionIds: mocks.listLiveAgentSessionIds,
}));
vi.mock("./agent-session-store", () => ({
  loadSessions: async () => mocks.sessions,
  deleteSessionsBySlug: mocks.deleteSessionsBySlug,
  endSessionsBySlug: mocks.endSessionsBySlug,
  normalizeLegacyBudaSessions: mocks.normalizeLegacyBudaSessions,
}));
vi.mock("./buda-connection", () => ({
  disconnectBuda: mocks.disconnectBuda,
  getOwnedBudaConnectionIdentity: mocks.getOwnedBudaConnectionIdentity,
}));

import { deleteAgentHistory, disconnectAgentConnection } from "./agent-connection";

describe("disconnectAgentConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions = [
      { id: "session-1", slug: "buda:agent-1" },
      { id: "session-2", slug: "codex-acp" },
    ];
    mocks.deleteSessionsBySlug.mockResolvedValue(1);
    mocks.endSessionsBySlug.mockImplementation(async (slug: string) =>
      mocks.sessions.filter((session) => session.slug === slug).map((session) => session.id),
    );
    mocks.listLiveAgentSessionIds.mockReturnValue([]);
    mocks.disconnectBuda.mockResolvedValue(true);
    mocks.getOwnedBudaConnectionIdentity.mockResolvedValue({
      canonicalSlug: "buda:agent-1",
      legacy: false,
    });
  });

  it("tombstones active sessions, revokes Buda, and retains scoped history", async () => {
    mocks.sessions.push({ id: "session-failed", slug: "buda:agent-1" });
    mocks.endSessionsBySlug.mockResolvedValueOnce(["session-1"]);

    await expect(disconnectAgentConnection("buda:agent-1")).resolves.toEqual({
      ok: true,
      endedSessionCount: 1,
    });

    expect(mocks.closeAgentSessions).toHaveBeenCalledWith(["session-1", "session-failed"]);
    expect(mocks.disconnectBuda).toHaveBeenCalledWith("buda:agent-1");
    expect(mocks.deleteSessionsBySlug).not.toHaveBeenCalled();
  });

  it("removes local-agent sessions without OAuth revocation", async () => {
    await disconnectAgentConnection("codex-acp");

    expect(mocks.closeAgentSessions).toHaveBeenCalledWith(["session-2"]);
    expect(mocks.disconnectBuda).not.toHaveBeenCalled();
    expect(mocks.endSessionsBySlug).toHaveBeenCalledWith("codex-acp");
  });

  it("rejects an unknown local connection", async () => {
    mocks.sessions = mocks.sessions.filter((session) => session.slug !== "claude-acp");

    await expect(disconnectAgentConnection("claude-acp")).rejects.toThrow(
      "Agent connection not found.",
    );
  });

  it("does not let canonical agent B claim legacy agent A history", async () => {
    mocks.sessions = [
      { id: "legacy-a", slug: "buda" },
      { id: "canonical-b", slug: "buda:agent-b" },
    ];
    mocks.getOwnedBudaConnectionIdentity.mockResolvedValue({
      canonicalSlug: "buda:agent-b",
      legacy: false,
    });
    mocks.endSessionsBySlug.mockResolvedValue(["canonical-b"]);

    await disconnectAgentConnection("buda:agent-b");

    expect(mocks.normalizeLegacyBudaSessions).not.toHaveBeenCalled();
    expect(mocks.endSessionsBySlug).toHaveBeenCalledWith("buda:agent-b");
    expect(mocks.closeAgentSessions).toHaveBeenCalledWith(["canonical-b"]);
  });

  it("deletes history separately without revoking the credential", async () => {
    await expect(deleteAgentHistory("buda:agent-1")).resolves.toEqual({
      ok: true,
      deletedSessionCount: 1,
    });
    expect(mocks.endSessionsBySlug).toHaveBeenCalledWith("buda:agent-1");
    expect(mocks.deleteSessionsBySlug).toHaveBeenCalledWith("buda:agent-1");
    expect(mocks.closeAgentSessions).toHaveBeenCalledWith(["session-1"]);
    expect(mocks.disconnectBuda).not.toHaveBeenCalled();
  });

  it("normalizes owned legacy Buda history before deleting it", async () => {
    mocks.sessions = [
      { id: "legacy-session", slug: "buda" },
      { id: "other-session", slug: "buda:agent-2" },
    ];
    mocks.getOwnedBudaConnectionIdentity.mockResolvedValue({
      canonicalSlug: "buda:agent-1",
      legacy: true,
    });
    mocks.normalizeLegacyBudaSessions.mockImplementation(async (slug: string) => {
      mocks.sessions = mocks.sessions.map((session) =>
        session.slug === "buda" ? { ...session, slug } : session,
      );
      return 1;
    });

    await expect(deleteAgentHistory("buda:agent-1")).resolves.toEqual({
      ok: true,
      deletedSessionCount: 1,
    });

    expect(mocks.normalizeLegacyBudaSessions).toHaveBeenCalledWith("buda:agent-1");
    expect(mocks.endSessionsBySlug).toHaveBeenCalledWith("buda:agent-1");
    expect(mocks.deleteSessionsBySlug).toHaveBeenCalledWith("buda:agent-1");
    expect(mocks.closeAgentSessions).toHaveBeenCalledWith(["legacy-session"]);
    expect(mocks.disconnectBuda).not.toHaveBeenCalled();
  });

  it("closes a live-only local session when deleting history", async () => {
    mocks.sessions = [];
    mocks.deleteSessionsBySlug.mockResolvedValue(0);
    mocks.listLiveAgentSessionIds.mockReturnValue(["live-only"]);

    await expect(deleteAgentHistory("codex-acp")).resolves.toEqual({
      ok: true,
      deletedSessionCount: 0,
    });

    expect(mocks.endSessionsBySlug).toHaveBeenCalledWith("codex-acp");
    expect(mocks.deleteSessionsBySlug).toHaveBeenCalledWith("codex-acp");
    expect(mocks.closeAgentSessions).toHaveBeenCalledWith(["live-only"]);
  });
});
