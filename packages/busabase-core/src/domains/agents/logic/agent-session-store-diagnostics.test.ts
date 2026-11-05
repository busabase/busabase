import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withAgentSessionDiagnosticContext } from "./agent-session-diagnostics";

const mocks = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("../../../context", () => ({
  getContextActorId: () => "actor-private",
  getContextSpaceId: () => "space-private",
}));
vi.mock("../../../db", () => ({ getDb: async () => mocks.database }));

const { persistSessionEvents, acquireSessionLease, renewSessionLease, releaseSessionLease } =
  await import("./agent-session-store");

function fakeDatabase(
  options: { rows?: unknown[]; insertError?: unknown; updateError?: unknown } = {},
) {
  const returning = vi.fn(async () => {
    if (options.updateError) throw options.updateError;
    return options.rows ?? [];
  });
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const values = vi.fn(async () => {
    if (options.insertError) throw options.insertError;
  });
  const insert = vi.fn(() => ({ values }));
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ for: async () => [{ journalMode: "legacy" }] }) }),
  }));
  const transaction = vi.fn(async (operation: (tx: unknown) => Promise<void>) =>
    operation(database),
  );
  const database = { update, insert, select, transaction };
  return { database, returning, values, update, insert, transaction };
}

const event: AgentSessionEventVO = {
  sessionId: "ags_diagnostic",
  seq: 7,
  at: "2026-11-03T00:00:00Z",
  kind: "acpUpdate",
  acpUpdate: { sessionUpdate: "user_message", text: "sensitive-prompt-must-not-log" },
};

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("session-store observational diagnostics", () => {
  it("preserves fenced rejection and records its batch without an additional query", async () => {
    const fake = fakeDatabase();
    mocks.database = fake.database;
    const result = await withAgentSessionDiagnosticContext(
      { connectionId: "acp_test", operationId: "op_test" },
      () => persistSessionEvents([event], { ownerId: "owner_test", fencingToken: 4 }),
    );
    expect(result).toBe(false);
    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.insert).not.toHaveBeenCalled();
    expect(vi.mocked(console.warn).mock.calls[0]?.[1]).toMatchObject({
      event: "store_predicate_rejected",
      connectionId: "acp_test",
      operationId: "op_test",
      sessionId: "ags_diagnostic",
      stage: "event_commit",
      outcome: "ownership_rejected",
      reason: "predicate_not_matched",
      seqFrom: 7,
      seqThrough: 7,
      eventCount: 1,
      ownerId: "owner_test",
      fencingToken: 4,
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("sensitive-prompt");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("space-private");
  });

  it("keeps an unfenced SQL failure false and exposes SQLSTATE without query parameters", async () => {
    const sensitive = "sensitive-prompt-must-not-log sk_credentials_do_not_log";
    const fake = fakeDatabase({
      insertError: Object.assign(new Error(sensitive), {
        cause: { code: "23505", detail: sensitive },
      }),
    });
    mocks.database = fake.database;
    await expect(persistSessionEvents([event])).resolves.toBe(false);
    expect(fake.insert).toHaveBeenCalledTimes(1);
    expect(fake.transaction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]?.[1]).toMatchObject({
      stage: "event_commit",
      outcome: "storage_failure",
      sqlState: "23505",
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("sensitive-prompt");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("sk_credentials");
  });

  it("keeps lease acquisition exceptions throwing but renew failures false", async () => {
    const failure = Object.assign(new Error("private SQL bind"), { code: "08006" });
    mocks.database = fakeDatabase({ updateError: failure }).database;
    await expect(acquireSessionLease("ags_diagnostic", "owner_test")).rejects.toBe(failure);
    await expect(renewSessionLease("ags_diagnostic", "owner_test", 1)).resolves.toBe(false);
    await expect(releaseSessionLease("ags_diagnostic", "owner_test", 1)).rejects.toBe(failure);
    expect(vi.mocked(console.warn).mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ stage: "lease_acquire", sqlState: "08006" }),
      expect.objectContaining({ stage: "lease_renew", sqlState: "08006" }),
      expect.objectContaining({ stage: "lease_release", sqlState: "08006" }),
    ]);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private SQL bind");
  });

  it("cannot change a rejected write when the diagnostic sink fails", async () => {
    mocks.database = fakeDatabase().database;
    vi.mocked(console.warn).mockImplementation(() => {
      throw new Error("sink failure");
    });
    await expect(
      persistSessionEvents([event], { ownerId: "owner_test", fencingToken: 1 }),
    ).resolves.toBe(false);
  });
});
