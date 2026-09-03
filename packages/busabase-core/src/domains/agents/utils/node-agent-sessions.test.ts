import { beforeEach, describe, expect, it } from "vitest";
import {
  type KnownAgentSession,
  lookupNodeAgentSession,
  nodeAgentKey,
  rememberNodeAgentSession,
  resetNodeAgentSessions,
  resolveNodeAgentSession,
} from "./node-agent-sessions";

const session = (
  id: string,
  slug: string,
  status: KnownAgentSession["status"],
): KnownAgentSession => ({ id, slug, status });

describe("resolveNodeAgentSession", () => {
  const mapping = (nodeId: string, slug: string, sessionId: string) =>
    new Map([[nodeAgentKey(nodeId, slug), sessionId]]);

  it("continues the conversation this node already had with this agent", () => {
    const found = resolveNodeAgentSession(
      mapping("nod_doc", "claude", "s1"),
      [session("s1", "claude", "idle")],
      "nod_doc",
      "claude",
    );

    expect(found).toBe("s1");
  });

  // The whole point of keying by node: asking about a Base must not land in the
  // transcript where the Doc was discussed.
  it("starts fresh for a different node, even with the same agent open", () => {
    const found = resolveNodeAgentSession(
      mapping("nod_doc", "claude", "s1"),
      [session("s1", "claude", "idle")],
      "nod_base",
      "claude",
    );

    expect(found).toBeNull();
  });

  it("never adopts an unmapped session just because the agent has one", () => {
    const found = resolveNodeAgentSession(
      new Map(),
      [session("s1", "claude", "idle")],
      "nod_doc",
      "claude",
    );

    expect(found).toBeNull();
  });

  // `promptAgentSession` throws on a failed session, and an ended one has no
  // process left — reusing either would fail at send time, long after the click.
  it.each(["failed", "ended"] as const)("refuses a %s session", (status) => {
    const found = resolveNodeAgentSession(
      mapping("nod_doc", "claude", "s1"),
      [session("s1", "claude", status)],
      "nod_doc",
      "claude",
    );

    expect(found).toBeNull();
  });

  it.each(["connecting", "idle", "busy", "waiting_permission"] as const)(
    "reuses a %s session — a mid-turn session still takes a queued draft",
    (status) => {
      const found = resolveNodeAgentSession(
        mapping("nod_doc", "claude", "s1"),
        [session("s1", "claude", status)],
        "nod_doc",
        "claude",
      );

      expect(found).toBe("s1");
    },
  );

  it("treats a pruned session id as gone rather than trusting the mapping", () => {
    const found = resolveNodeAgentSession(
      mapping("nod_doc", "claude", "s1"),
      [],
      "nod_doc",
      "claude",
    );

    expect(found).toBeNull();
  });

  it("refuses a mapped id that now belongs to a different agent", () => {
    const found = resolveNodeAgentSession(
      mapping("nod_doc", "claude", "s1"),
      [session("s1", "codex", "idle")],
      "nod_doc",
      "claude",
    );

    expect(found).toBeNull();
  });
});

describe("the process-wide mapping", () => {
  beforeEach(resetNodeAgentSessions);

  it("remembers per (node, agent), so three asks about one node are one conversation", () => {
    const known = [session("s1", "claude", "idle"), session("s2", "claude", "idle")];
    rememberNodeAgentSession("nod_doc", "claude", "s1");
    rememberNodeAgentSession("nod_base", "claude", "s2");

    expect(lookupNodeAgentSession(known, "nod_doc", "claude")).toBe("s1");
    expect(lookupNodeAgentSession(known, "nod_base", "claude")).toBe("s2");
  });

  it("re-points a node at the replacement session once the old one dies", () => {
    rememberNodeAgentSession("nod_doc", "claude", "s1");
    expect(lookupNodeAgentSession([session("s1", "claude", "failed")], "nod_doc", "claude")).toBe(
      null,
    );

    rememberNodeAgentSession("nod_doc", "claude", "s2");
    expect(
      lookupNodeAgentSession(
        [session("s1", "claude", "failed"), session("s2", "claude", "idle")],
        "nod_doc",
        "claude",
      ),
    ).toBe("s2");
  });
});
