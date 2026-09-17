import { describe, expect, it, vi } from "vitest";

/**
 * `toVO`'s model-option boundary (PUL-246) — the piece a mocked-store test
 * like `agent-session-manager.test.ts` cannot exercise, because that suite
 * replaces `./agent-session-store` wholesale and never runs the real `toVO`.
 * This file drives the real store against a fake drizzle query builder that
 * hands back canned rows, so `parseStoredModelOption`'s validation actually
 * runs.
 *
 * The fake only needs to satisfy the chains this file's functions call:
 * `.select().from().where().orderBy()` and `.select().from().where().limit()`.
 * Both are thenables in real drizzle; returning a plain resolved-array-like
 * chain here is enough without pulling in a real Postgres/pglite instance.
 */

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
}));

function fakeQuery() {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(mocks.rows),
    // biome-ignore lint/suspicious/noThenProperty: mocks drizzle's thenable query builder
    then: (resolve: (value: unknown[]) => void) => resolve(mocks.rows),
  };
  return chain;
}

vi.mock("../../../context", () => ({
  getContextActorId: () => null,
  getContextSpaceId: () => "space-1",
}));

vi.mock("../../../db", () => ({
  getDb: async () => ({
    select: fakeQuery,
  }),
}));

const { loadScopedSession, loadSessions } = await import("./agent-session-store");

const baseRow = {
  id: "ags-1",
  spaceId: "space-1",
  actorId: null,
  slug: "test-agent",
  agentName: "Test Agent",
  transport: "remote-websocket" as const,
  status: "idle" as const,
  acpSessionId: "acp-1",
  error: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastActivityAt: new Date("2026-01-01T00:00:00Z"),
  endedAt: null,
  leaseOwnerId: null,
  leaseFencingToken: 0,
  leaseExpiresAt: null,
  modelOption: null as unknown,
};

const VALID_MODEL_OPTION = {
  id: "model",
  name: "Model",
  currentValue: "auto",
  options: [{ value: "auto", name: "Auto" }],
};

describe("agent session store — durable model option (PUL-246)", () => {
  it("surfaces a well-formed stored model option for a live remote-websocket session", async () => {
    mocks.rows = [{ ...baseRow, modelOption: VALID_MODEL_OPTION }];
    const session = await loadScopedSession("ags-1");
    expect(session?.modelOption).toEqual(VALID_MODEL_OPTION);
  });

  it("never advertises a model option for a local-subprocess row, even if one is stored", async () => {
    // Nothing in this domain ever writes one for local-subprocess (see
    // `syncModelOption`), but a boundary that trusted the column verbatim
    // would still be wrong if some future write path did.
    mocks.rows = [{ ...baseRow, transport: "local-subprocess", modelOption: VALID_MODEL_OPTION }];
    const session = await loadScopedSession("ags-1");
    expect(session?.modelOption).toBeNull();
  });

  it("hides the model option once the session is ended, even though the column still has one", async () => {
    mocks.rows = [
      { ...baseRow, status: "ended", endedAt: new Date(), modelOption: VALID_MODEL_OPTION },
    ];
    const session = await loadScopedSession("ags-1");
    expect(session?.modelOption).toBeNull();
  });

  it("hides the model option once the session is failed", async () => {
    mocks.rows = [{ ...baseRow, status: "failed", modelOption: VALID_MODEL_OPTION }];
    const session = await loadScopedSession("ags-1");
    expect(session?.modelOption).toBeNull();
  });

  it("treats a missing stored value as no model option", async () => {
    mocks.rows = [{ ...baseRow, modelOption: null }];
    const session = await loadScopedSession("ags-1");
    expect(session?.modelOption).toBeNull();
  });

  it("degrades a malformed stored value to null instead of throwing", async () => {
    mocks.rows = [{ ...baseRow, modelOption: { unexpected: "shape" } }];
    const session = await loadScopedSession("ags-1");
    expect(session?.modelOption).toBeNull();
  });

  it("degrades a non-object stored value (e.g. a stale string) to null instead of throwing", async () => {
    mocks.rows = [{ ...baseRow, modelOption: "not-an-object" }];
    await expect(loadScopedSession("ags-1")).resolves.not.toThrow();
    const session = await loadScopedSession("ags-1");
    expect(session?.modelOption).toBeNull();
  });

  it("carries the durable model option through the plain session list too", async () => {
    mocks.rows = [{ ...baseRow, modelOption: VALID_MODEL_OPTION }];
    const sessions = await loadSessions();
    expect(sessions[0]?.modelOption).toEqual(VALID_MODEL_OPTION);
  });
});
