import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupervisedAgentCommand } from "./agent-session-supervisor";

let clock = Date.parse("2026-11-03T00:00:00Z");
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  clock += 2_000;
  vi.setSystemTime(clock);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const command = (commandId: string): SupervisedAgentCommand => ({
  commandId,
  kind: "prompt",
  state: "claimed",
  payload: { text: "local fixture" },
  createdAt: "2026-11-03T00:00:00Z",
  expiresAt: "2026-11-03T00:30:00Z",
  bindingGeneration: 1,
  claimingEpoch: 1,
  receipt: null,
});

describe("agent session state across independent instrumentation/route evaluation", () => {
  it("retained callback observes the later driver's durable dispatch marker and command identity", async () => {
    const instrumentation = await import("./agent-session-execution-context");
    const retainedCallback = async () => {
      const context = instrumentation.supervisedDispatch.getStore();
      expect(context?.command.commandId).toBe("command_route_B");
      await context?.beforeDispatch();
    };
    vi.resetModules();
    const route = await import("./agent-session-execution-context");
    expect(route.supervisedDispatch).toBe(instrumentation.supervisedDispatch);
    const beforeDispatch = vi.fn(async () => {});
    await route.supervisedDispatch.run(
      Object.freeze({ command: command("command_route_B"), beforeDispatch }),
      retainedCallback,
    );
    expect(beforeDispatch).toHaveBeenCalledOnce();
    expect(route.supervisedDispatch.getStore()).toBeUndefined();
  });

  it("keeps concurrent command and dispatch callbacks isolated across module evaluations", async () => {
    const a = await import("./agent-session-execution-context");
    vi.resetModules();
    const b = await import("./agent-session-execution-context");
    const beforeA = vi.fn(async () => {});
    const beforeB = vi.fn(async () => {});
    await Promise.all([
      a.supervisedDispatch.run(
        Object.freeze({ command: command("command_A"), beforeDispatch: beforeA }),
        async () => {
          await Promise.resolve();
          expect(b.supervisedDispatch.getStore()?.command.commandId).toBe("command_A");
          await b.supervisedDispatch.getStore()?.beforeDispatch();
        },
      ),
      b.supervisedDispatch.run(
        Object.freeze({ command: command("command_B"), beforeDispatch: beforeB }),
        async () => {
          await Promise.resolve();
          expect(a.supervisedDispatch.getStore()?.command.commandId).toBe("command_B");
          await a.supervisedDispatch.getStore()?.beforeDispatch();
        },
      ),
    ]);
    expect(beforeA).toHaveBeenCalledOnce();
    expect(beforeB).toHaveBeenCalledOnce();
    expect(a.supervisedDispatch.getStore()).toBeUndefined();
  });

  it("recognizes immutable server error brands across different constructor identities", async () => {
    const host = await import("./agent-session-supervisor");
    const denied = new host.AgentSessionSupervisorAuthorizationError("fixture revoked");
    const rejected = new host.AgentSessionCommandAdmissionError("COMMAND_RECEIPT_CAPACITY");
    vi.resetModules();
    const route = await import("./agent-session-supervisor");
    expect(denied instanceof route.AgentSessionSupervisorAuthorizationError).toBe(false);
    expect(rejected instanceof route.AgentSessionCommandAdmissionError).toBe(false);
    expect(route.isAgentSessionSupervisorAuthorizationError(denied)).toBe(true);
    expect(route.isAgentSessionCommandAdmissionError(rejected)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(rejected, "errorCode")).toMatchObject({
      writable: false,
      configurable: false,
    });
    expect(
      Object.getOwnPropertyDescriptor(
        denied,
        Symbol.for("busabase.agent-session.supervisor-authorization-error"),
      ),
    ).toMatchObject({ value: true, writable: false, configurable: false });
    expect(route.isAgentSessionSupervisorAuthorizationError({ name: denied.name })).toBe(false);
    expect(
      route.isAgentSessionCommandAdmissionError({
        name: rejected.name,
        errorCode: "COMMAND_RECEIPT_CAPACITY",
      }),
    ).toBe(false);
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error("hostile getter");
        },
      },
    );
    expect(() => route.isAgentSessionSupervisorAuthorizationError(hostile)).not.toThrow();
    expect(route.isAgentSessionSupervisorAuthorizationError(hostile)).toBe(false);
    expect(route.isAgentSessionCommandAdmissionError(hostile)).toBe(false);
  });

  it("shares diagnostic correlation and a stable worker ID without crossing concurrent operations", async () => {
    const host = await import("./agent-session-diagnostics");
    vi.resetModules();
    const route = await import("./agent-session-diagnostics");
    await Promise.all([
      host.withAgentSessionDiagnosticContext(
        { sessionId: "session_A", operationId: "operation_A" },
        async () => {
          await Promise.resolve();
          expect(Object.isFrozen(route.captureAgentSessionDiagnosticContext())).toBe(true);
          route.logAgentSessionDiagnostic("module_boundary", {}, { force: true });
        },
      ),
      route.withAgentSessionDiagnosticContext(
        { sessionId: "session_B", operationId: "operation_B" },
        async () => {
          await Promise.resolve();
          host.logAgentSessionDiagnostic("module_boundary", {}, { force: true });
        },
      ),
    ]);
    const records = vi
      .mocked(console.info)
      .mock.calls.map(([, record]) => record as Record<string, unknown>);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: "session_A", operationId: "operation_A" }),
        expect.objectContaining({ sessionId: "session_B", operationId: "operation_B" }),
      ]),
    );
    expect(new Set(records.map((record) => record.workerId)).size).toBe(1);
    expect(host.captureAgentSessionDiagnosticContext()).toEqual({});
  });

  it("enforces one bounded diagnostic budget across separately evaluated modules", async () => {
    const host = await import("./agent-session-diagnostics");
    vi.resetModules();
    const route = await import("./agent-session-diagnostics");
    for (let n = 0; n < 100; n++)
      (n % 2 ? host : route).logAgentSessionDiagnostic("bounded_success");
    expect(console.info).toHaveBeenCalledTimes(20);
    route.logAgentSessionDiagnostic("unsampled_failure", {}, { level: "warn" });
    expect(console.warn).toHaveBeenCalledWith(
      "[agents:session]",
      expect.objectContaining({ suppressedSuccessCount: 80 }),
    );
  });

  it.each([
    ["VERCEL", "1"],
    ["AWS_LAMBDA_FUNCTION_NAME", "acp-test-function"],
    ["NETLIFY", "true"],
  ])(
    "rejects request-only %s startup before host registration or scanner work",
    async (key, value) => {
      vi.stubEnv("BUSABASE_AGENT_SUPERVISOR_ENABLED", "true");
      vi.stubEnv("BUSABASE_AGENT_LEGACY_WRITERS_DRAINED", "true");
      vi.stubEnv(key, value);
      const module = await import("./agent-session-supervisor");
      const state = (
        globalThis as typeof globalThis & {
          __busabaseSessionSupervisor?: { host?: unknown; timer?: unknown; stopping: boolean };
        }
      ).__busabaseSessionSupervisor;
      if (!state) throw new Error("Expected initialized supervisor registry");
      const previous = { host: state.host, timer: state.timer, stopping: state.stopping };
      const database = vi.fn(async () => {
        throw new Error("Scanner must not start");
      });
      expect(() =>
        module.startAgentSessionSupervisorHost({
          database,
          runAs: async (_scope, operation) => operation(),
        }),
      ).toThrow("request-only runtimes are unsupported");
      expect(state.host).toBe(previous.host);
      expect(state.timer).toBe(previous.timer);
      expect(state.stopping).toBe(previous.stopping);
      expect(database).not.toHaveBeenCalled();
      expect(() => module.assertAgentSessionSupervisorAvailable()).toThrow(
        "request-only runtimes are unsupported",
      );
    },
  );
});
