import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentSessionScopeReferences,
  captureAgentSessionDiagnosticContext,
  describeAgentSessionStorageError,
  logAgentSessionDiagnostic,
  withAgentSessionDiagnosticContext,
} from "./agent-session-diagnostics";

let clock = Date.parse("2026-11-03T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  clock += 2_000;
  vi.setSystemTime(clock);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("agent session safe diagnostics", () => {
  it("walks nested database causes and emits only known machine metadata", () => {
    const sensitive = "private prompt sk_super_secret_token signed-url attachment-base64";
    const error = Object.assign(new Error(`query ${sensitive}`), {
      query: sensitive,
      params: [sensitive],
      cause: Object.assign(new Error(`bind values ${sensitive}`), {
        code: "23505",
        detail: sensitive,
        table_name: "busabase_agent_session_events",
        constraint_name: "busabase_agent_session_events_session_seq_idx",
      }),
    });

    expect(describeAgentSessionStorageError(error)).toEqual({
      failureClass: "storage_failure",
      sqlState: "23505",
      table: "busabase_agent_session_events",
      constraint: "busabase_agent_session_events_session_seq_idx",
    });
    logAgentSessionDiagnostic(
      "event_commit_failed",
      {
        sessionId: "ags_test",
        stage: "event_commit",
        outcome: "storage_failure",
        query: sensitive,
        payload: sensitive,
        headers: { authorization: sensitive },
      },
      { level: "warn", error },
    );
    const record = vi.mocked(console.warn).mock.calls[0]?.[1];
    expect(record).toMatchObject({
      schemaVersion: 1,
      sessionId: "ags_test",
      sqlState: "23505",
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("sk_super_secret_token");
    expect(serialized).not.toContain("signed-url");
    expect(serialized).not.toContain("attachment-base64");
    expect(serialized).not.toContain("query");
  });

  it("does not classify arbitrary upstream errors as database failures", () => {
    const error = new Error("Unauthorized: private upstream peer message");
    expect(describeAgentSessionStorageError(error)).toEqual({
      failureClass: "unclassified_failure",
    });
    logAgentSessionDiagnostic("handshake_failed", {}, { level: "warn", error });
    expect(vi.mocked(console.warn).mock.calls[0]?.[1]).toMatchObject({
      failureClass: "unclassified_failure",
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("Unauthorized");
  });

  it("handles cyclic or hostile error causes without evaluating arbitrary details", () => {
    const error: { cause?: unknown; code?: string } = { code: "ETIMEDOUT" };
    error.cause = error;
    expect(describeAgentSessionStorageError(error)).toEqual({
      failureClass: "connection_failure",
      driverCode: "ETIMEDOUT",
    });
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error("getter secret");
        },
      },
    );
    expect(() => describeAgentSessionStorageError(hostile)).not.toThrow();
    expect(describeAgentSessionStorageError(hostile)).toEqual({
      failureClass: "unclassified_failure",
    });
  });

  it("drops unknown table/constraint names rather than sanitizing their content", () => {
    expect(
      describeAgentSessionStorageError({
        code: "23505",
        table: "private_customer_email",
        constraint: "private_prompt_and_credential",
      }),
    ).toEqual({ failureClass: "storage_failure", sqlState: "23505" });
  });

  it("retains immutable scoped correlation across await without crossing concurrent tasks", async () => {
    const shared = { connectionId: "acp_connection_A", sessionId: "ags_A" };
    const captured = captureAgentSessionDiagnosticContext(shared);
    shared.sessionId = "ags_mutated";
    expect(Object.isFrozen(captured)).toBe(true);
    await Promise.all([
      withAgentSessionDiagnosticContext(captured, async () => {
        await Promise.resolve();
        logAgentSessionDiagnostic("commit_completed", { operationId: "op_A" }, { force: true });
      }),
      withAgentSessionDiagnosticContext(
        { connectionId: "acp_connection_B", sessionId: "ags_B" },
        async () => {
          await Promise.resolve();
          logAgentSessionDiagnostic("commit_completed", { operationId: "op_B" }, { force: true });
        },
      ),
    ]);
    expect(vi.mocked(console.info).mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({
        connectionId: "acp_connection_A",
        sessionId: "ags_A",
        operationId: "op_A",
      }),
      expect.objectContaining({
        connectionId: "acp_connection_B",
        sessionId: "ags_B",
        operationId: "op_B",
      }),
    ]);
    expect(captureAgentSessionDiagnosticContext()).toEqual({});
  });

  it("removes URL userinfo, query and fragments and excludes credential-shaped identifiers", () => {
    logAgentSessionDiagnostic("endpoint_resolved", {
      endpoint: "wss://user:secret@buda.example/api/acp?token=secret#secret",
      sessionId: "sk_credential_should_not_appear",
      agentRef: "abcdef123456",
    });
    expect(vi.mocked(console.info).mock.calls[0]?.[1]).toMatchObject({
      endpoint: "wss://buda.example/api/acp",
      agentRef: "abcdef123456",
    });
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("secret");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("sk_credential");
  });

  it("bounds success records and reports suppression on an unsampled failure and end summary", () => {
    for (let n = 0; n < 10_000; n += 1)
      logAgentSessionDiagnostic("commit_completed", { eventCount: 1 });
    expect(console.info).toHaveBeenCalledTimes(20);
    logAgentSessionDiagnostic(
      "commit_failed",
      { outcome: "ownership_rejected" },
      { level: "warn" },
    );
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]?.[1]).toMatchObject({
      suppressedSuccessCount: 9980,
    });
    logAgentSessionDiagnostic("session_ended", {}, { force: true });
    expect(console.info).toHaveBeenCalledTimes(21);
  });

  it("cannot fail a request when the console sink throws", () => {
    vi.mocked(console.warn).mockImplementation(() => {
      throw new Error("sink unavailable");
    });
    expect(() =>
      logAgentSessionDiagnostic(
        "commit_failed",
        {},
        { level: "warn", error: new Error("private") },
      ),
    ).not.toThrow();
  });

  it("hashes scope identifiers without retaining raw tenant or actor values", () => {
    const references = agentSessionScopeReferences({
      spaceId: "private-space",
      actorId: "private-user",
    });
    expect(references).toEqual({
      spaceRef: expect.stringMatching(/^[0-9a-f]{12}$/),
      actorRef: expect.stringMatching(/^[0-9a-f]{12}$/),
    });
    expect(JSON.stringify(references)).not.toContain("private");
    expect(
      agentSessionScopeReferences({ spaceId: "private-space", actorId: null }),
    ).not.toHaveProperty("actorRef");
  });
  it("does not attribute a socket errno to SQL solely because it has five letters", () => {
    expect(
      describeAgentSessionStorageError(
        Object.assign(new Error("private socket target"), { code: "EPIPE" }),
      ),
    ).toEqual({ failureClass: "connection_failure", driverCode: "EPIPE" });
  });
});
