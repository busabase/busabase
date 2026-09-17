import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import { paginateAgentSessions } from "./agent-session-pagination";

const session = (id: string, slug: string, lastActivityAt: string): AgentSessionVO => ({
  id,
  slug,
  agentName: slug,
  transport: "local-subprocess",
  status: "idle",
  createdAt: lastActivityAt,
  lastActivityAt,
  error: null,
  modelOption: null,
});

describe("paginateAgentSessions", () => {
  const sessions = [
    session("other", "other", "2026-09-11T12:00:00.000Z"),
    session("newest", "buda", "2026-09-11T11:00:00.000Z"),
    session("tie-b", "buda", "2026-09-11T10:00:00.000Z"),
    session("tie-a", "buda", "2026-09-11T10:00:00.000Z"),
    session("oldest", "buda", "2026-09-11T09:00:00.000Z"),
  ];

  it("returns stable newest-first pages scoped to one agent", () => {
    const first = paginateAgentSessions(sessions, { slug: "buda", limit: 2 });
    expect(first.items.map(({ id }) => id)).toEqual(["newest", "tie-b"]);
    expect(first.nextCursor).not.toBeNull();

    const second = paginateAgentSessions(sessions, {
      slug: "buda",
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map(({ id }) => id)).toEqual(["tie-a", "oldest"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects malformed cursors instead of silently restarting at page one", () => {
    expect(() =>
      paginateAgentSessions(sessions, { slug: "buda", limit: 2, cursor: "broken" }),
    ).toThrow("Invalid agent session cursor");
  });
});
