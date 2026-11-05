import { randomUUID } from "node:crypto";
import type { AgentSessionCommandKind } from "busabase-contract/domains/agents/types";
import { type BusabaseDatabase, runWithBusabaseContext } from "../../../context";
import {
  describeAgentSessionStorageError,
  logAgentSessionDiagnostic,
  withAgentSessionDiagnosticContext,
} from "./agent-session-diagnostics";
import { journalSynchronizationErrorBrand } from "./agent-session-execution-context";
import {
  type AgentSessionWriterLease,
  claimSessionCommands,
  claimWriterLease,
  expireSessionCommands,
  getJournalRuntime,
  hasPendingSessionCommands,
  listSessionCommandDemand,
  loadSessionCommands,
  releaseWriterLease,
  renewWriterLease,
  touchJournalDemand,
  transitionSessionCommand,
  updateJournalRuntime,
} from "./agent-session-journal-store";
import type { AgentSessionScope } from "./agent-session-store";

type JournalRuntime = NonNullable<Awaited<ReturnType<typeof getJournalRuntime>>>;
export type SupervisedAgentCommand = Awaited<ReturnType<typeof loadSessionCommands>>[number];

export interface AgentSessionSupervisorDriver {
  isConnected?(sessionId: string, lease: AgentSessionWriterLease): boolean;
  connect(
    runtime: JournalRuntime,
    lease: AgentSessionWriterLease,
    scope: AgentSessionScope,
  ): Promise<void>;
  execute(
    sessionId: string,
    command: SupervisedAgentCommand,
    beforeDispatch: () => Promise<void>,
  ): Promise<unknown>;
  reconcile(
    sessionId: string,
    command: SupervisedAgentCommand,
  ): Promise<{
    state: "accepted" | "running" | "completed" | "rejected" | "unknown";
    result?: Record<string, unknown>;
  }>;
  detach(sessionId: string, lease: AgentSessionWriterLease): void;
}

const admissionErrorBrand = Symbol.for("busabase.agent-session.command-admission-error");
const authorizationErrorBrand = Symbol.for("busabase.agent-session.supervisor-authorization-error");
const safeAdmissionCode = /^[A-Z][A-Z0-9_]{0,79}$/;

function hasErrorBrand(error: unknown, brand: symbol): error is object {
  if (!error || typeof error !== "object") return false;
  try {
    return Reflect.get(error, brand) === true;
  } catch {
    return false;
  }
}

/** Symbols cannot be supplied by JSON-RPC data or correlation headers. */
export class AgentSessionCommandAdmissionError extends Error {
  override readonly name = "AgentSessionCommandAdmissionError";
  readonly errorCode: string;
  constructor(errorCode: string) {
    super("The remote agent rejected this command before admitting execution.");
    this.errorCode = safeAdmissionCode.test(errorCode) ? errorCode : "COMMAND_ADMISSION_REJECTED";
    Object.defineProperty(this, admissionErrorBrand, { value: true });
    Object.defineProperty(this, "errorCode", {
      value: this.errorCode,
      writable: false,
      configurable: false,
    });
  }
}

export class AgentSessionSupervisorAuthorizationError extends Error {
  override readonly name = "AgentSessionSupervisorAuthorizationError";
  constructor(message = "The agent session actor is no longer authorized.") {
    super(message);
    Object.defineProperty(this, authorizationErrorBrand, { value: true });
  }
}

export function isAgentSessionCommandAdmissionError(
  error: unknown,
): error is AgentSessionCommandAdmissionError {
  if (!hasErrorBrand(error, admissionErrorBrand)) return false;
  try {
    const code = Reflect.get(error, "errorCode");
    return typeof code === "string" && safeAdmissionCode.test(code);
  } catch {
    return false;
  }
}

export function isAgentSessionSupervisorAuthorizationError(
  error: unknown,
): error is AgentSessionSupervisorAuthorizationError {
  return hasErrorBrand(error, authorizationErrorBrand);
}

export interface AgentSessionSupervisorHost {
  database: () => Promise<BusabaseDatabase>;
  /** Rebuild current authorization/vault context; never reuse an ended request's ALS. */
  runAs<T>(scope: AgentSessionScope, operation: () => Promise<T>): Promise<T>;
}

interface Owner {
  sessionId: string;
  scope: AgentSessionScope;
  lease: AgentSessionWriterLease;
  connected: boolean;
  connecting: Promise<void> | null;
  data: Promise<void> | null;
  dataCommandId?: string;
  controls: Map<string, Promise<void>>;
  renewedAt: number;
  reconciledAt: number;
  stopped: boolean;
}

interface SupervisorState {
  driver?: AgentSessionSupervisorDriver;
  host?: AgentSessionSupervisorHost;
  timer?: ReturnType<typeof setInterval>;
  ticking?: Promise<void>;
  stopping: boolean;
  shutdownInstalled?: boolean;
  retryAfter?: Map<
    string,
    { failures: number; nextAt: number; terminal?: boolean; diagnosticRef?: string }
  >;
  owners: Map<string, Owner>;
  demand: Map<string, { scope: AgentSessionScope; references: number; touchedAt: number }>;
}

const globals = globalThis as typeof globalThis & { __busabaseSessionSupervisor?: SupervisorState };
if (!globals.__busabaseSessionSupervisor) {
  globals.__busabaseSessionSupervisor = { stopping: false, owners: new Map(), demand: new Map() };
}
const state: SupervisorState = globals.__busabaseSessionSupervisor;
state.retryAfter ??= new Map();
const TICK_MS = 500;
const WRITER_TTL_SECONDS = 45;
const MAX_OWNERS = 100;
const MAX_CONTROLS = 4;
const ownerKey = (sessionId: string, scope: AgentSessionScope) =>
  JSON.stringify([scope.spaceId, scope.actorId, sessionId]);

export function agentSessionSupervisorRequested(): boolean {
  return process.env.BUSABASE_AGENT_SUPERVISOR_ENABLED === "true";
}

function assertPersistentSupervisorHost(): void {
  if (
    process.env.VERCEL === "1" ||
    process.env.AWS_LAMBDA_FUNCTION_NAME?.trim() ||
    ["true", "1"].includes(process.env.NETLIFY ?? "")
  )
    throw new Error(
      "Supervised ACP sessions require a persistent Node host; request-only runtimes are unsupported.",
    );
}

export function assertAgentSessionSupervisorAvailable(): void {
  if (!agentSessionSupervisorRequested())
    throw new Error("Supervised agent sessions are disabled.");
  assertPersistentSupervisorHost();
  if (process.env.BUSABASE_AGENT_LEGACY_WRITERS_DRAINED !== "true")
    throw new Error("Supervised agent sessions require the coordinated legacy-worker drain.");
  if (!state.host || !state.driver || state.stopping)
    throw new Error("This host has no active agent session supervisor. History remains readable.");
}

export function registerAgentSessionSupervisorDriver(driver: AgentSessionSupervisorDriver): void {
  state.driver = driver;
}

/** Node host startup owns this timer; it is not tied to any browser request. */
export function startAgentSessionSupervisorHost(
  host: AgentSessionSupervisorHost,
): () => Promise<void> {
  if (agentSessionSupervisorRequested()) {
    assertPersistentSupervisorHost();
    if (process.env.BUSABASE_AGENT_LEGACY_WRITERS_DRAINED !== "true")
      throw new Error("Refusing supervised ACP startup before the legacy-worker drain.");
  }
  state.host = host;
  state.stopping = false;
  if (agentSessionSupervisorRequested()) {
    state.timer ??= setInterval(() => void wakeAgentSessionSupervisor(), TICK_MS);
    state.timer.unref?.();
    void wakeAgentSessionSupervisor();
  }
  return stopAgentSessionSupervisorHost;
}

function logOwner(
  owner: Owner,
  event: string,
  outcome: string,
  error?: unknown,
  diagnosticRef?: string,
): void {
  logAgentSessionDiagnostic(
    event,
    {
      sessionId: owner.sessionId,
      stage: "supervisor",
      outcome,
      ownerId: owner.lease.ownerId,
      fencingToken: owner.lease.epoch,
      diagnosticRef,
    },
    { level: error === undefined ? "info" : "warn", error, force: error !== undefined },
  );
}

async function retire(owner: Owner, release = true): Promise<void> {
  if (owner.stopped) return;
  owner.stopped = true;
  state.owners.delete(ownerKey(owner.sessionId, owner.scope));
  state.driver?.detach(owner.sessionId, owner.lease);
  if (release) await releaseWriterLease(owner.sessionId, owner.lease, owner.scope);
  logOwner(owner, "supervisor_detached", "detached");
}

async function cancelUndispatched(owner: Owner, command: SupervisedAgentCommand): Promise<boolean> {
  if (command.kind !== "cancel" || !command.targetCommandId) return false;
  const target = (await loadSessionCommands(owner.sessionId, owner.scope)).find(
    (item) => item.commandId === command.targetCommandId,
  );
  if (!target || !["queued", "claimed"].includes(target.state)) return false;
  const cancelled = await transitionSessionCommand(
    owner.sessionId,
    target.commandId,
    ["queued", "claimed"],
    "rejected",
    owner.lease,
    owner.scope,
    { errorCode: "CANCELLED_BEFORE_DISPATCH" },
  );
  if (!cancelled) return false; // Dispatch may have won after the read. Fall through to targeted cancellation.
  await transitionSessionCommand(
    owner.sessionId,
    command.commandId,
    ["claimed"],
    "completed",
    owner.lease,
    owner.scope,
    { receipt: { outcome: "cancelled_before_dispatch" } },
  );
  return true;
}

/** A rejected/failed command cannot be made to look unexecuted after socket send. */
async function execute(owner: Owner, command: SupervisedAgentCommand): Promise<void> {
  const driver = state.driver;
  if (!driver || owner.stopped) return;
  if (await cancelUndispatched(owner, command)) return;
  let dispatched = false;
  const beforeDispatch = async () => {
    if (dispatched) return;
    if (owner.stopped) throw new Error("The session writer changed before dispatch.");
    const changed = await transitionSessionCommand(
      owner.sessionId,
      command.commandId,
      ["claimed"],
      "dispatching",
      owner.lease,
      owner.scope,
    );
    if (!changed) throw new Error("The session writer changed before dispatch.");
    dispatched = true;
  };
  await withAgentSessionDiagnosticContext(
    {
      sessionId: owner.sessionId,
      operationId: command.commandId,
      attemptId: `attempt_${randomUUID()}`,
    },
    async () => {
      try {
        const result = await driver.execute(owner.sessionId, command, beforeDispatch);
        if (owner.stopped) return;
        await transitionSessionCommand(
          owner.sessionId,
          command.commandId,
          ["claimed", "dispatching", "observed", "unknown"],
          "completed",
          owner.lease,
          owner.scope,
          {
            receipt:
              result && typeof result === "object" ? (result as Record<string, unknown>) : {},
          },
        );
        if (command.kind === "close") {
          await updateJournalRuntime(
            owner.sessionId,
            { status: "ended", executionState: "terminal", connectionState: "disconnected" },
            owner.lease,
            owner.scope,
          );
          await retire(owner);
        }
      } catch (error) {
        const uncertain = dispatched && !isAgentSessionCommandAdmissionError(error);
        logOwner(owner, "supervisor_command_failed", uncertain ? "unknown" : "rejected", error);
        if (owner.stopped) return;
        await transitionSessionCommand(
          owner.sessionId,
          command.commandId,
          ["claimed", "dispatching", "observed"],
          uncertain ? "unknown" : "rejected",
          owner.lease,
          owner.scope,
          {
            errorCode: isAgentSessionCommandAdmissionError(error)
              ? error.errorCode
              : uncertain
                ? "DISPATCH_OUTCOME_UNKNOWN"
                : "COMMAND_NOT_DISPATCHED",
          },
        );
        if (uncertain) {
          const current = await getJournalRuntime(owner.sessionId, owner.scope).catch(() => null);
          await updateJournalRuntime(
            owner.sessionId,
            {
              executionState: "unknown",
              syncState:
                current?.session.reliability?.synchronization === "gap" ? "gap" : "recovering",
            },
            owner.lease,
            owner.scope,
          );
        }
      }
    },
  );
}

async function reconcile(owner: Owner): Promise<void> {
  if (!state.driver || owner.stopped || Date.now() - owner.reconciledAt < 2_000) return;
  owner.reconciledAt = Date.now();
  const commands = await loadSessionCommands(owner.sessionId, owner.scope);
  for (const command of commands) {
    if (!["dispatching", "observed", "unknown", "claimed"].includes(command.state)) continue;
    if (owner.controls.has(command.commandId) || owner.dataCommandId === command.commandId)
      continue;
    if (command.state === "claimed") {
      // A claimed command has no durable dispatch marker. The new owner may
      // safely reclaim it, but never a dispatching/unknown command by this rule.
      const reset = await transitionSessionCommand(
        owner.sessionId,
        command.commandId,
        ["claimed"],
        "queued",
        owner.lease,
        owner.scope,
      );
      if (reset) continue;
    }
    const receipt = await state.driver
      .reconcile(owner.sessionId, command)
      .catch(() => ({ state: "unknown" as const }));
    if (receipt.state === "completed" || receipt.state === "rejected") {
      await transitionSessionCommand(
        owner.sessionId,
        command.commandId,
        ["dispatching", "observed", "unknown"],
        receipt.state,
        owner.lease,
        owner.scope,
        {
          receipt: receipt.result ?? {},
          ...(receipt.state === "rejected" &&
          receipt.result?.code === "COMMAND_EXPIRED_BEFORE_DISPATCH"
            ? { errorCode: "COMMAND_EXPIRED_BEFORE_DISPATCH" }
            : {}),
        },
      );
    } else if (receipt.state === "running") {
      await updateJournalRuntime(
        owner.sessionId,
        { executionState: "running" },
        owner.lease,
        owner.scope,
      );
      await transitionSessionCommand(
        owner.sessionId,
        command.commandId,
        ["dispatching", "unknown"],
        "observed",
        owner.lease,
        owner.scope,
      );
    } else if (receipt.state === "accepted") {
      await updateJournalRuntime(
        owner.sessionId,
        { executionState: "reserved" },
        owner.lease,
        owner.scope,
      );
      // Only the negotiated driver can prove that remote durable admission
      // is still undispatched; reuse the same identity, never a new prompt.
      await transitionSessionCommand(
        owner.sessionId,
        command.commandId,
        ["dispatching", "observed", "unknown"],
        "queued",
        owner.lease,
        owner.scope,
      );
    } else {
      await updateJournalRuntime(
        owner.sessionId,
        { executionState: "unknown" },
        owner.lease,
        owner.scope,
      );
      await transitionSessionCommand(
        owner.sessionId,
        command.commandId,
        ["dispatching", "observed"],
        "unknown",
        owner.lease,
        owner.scope,
        { errorCode: "DISPATCH_OUTCOME_UNKNOWN" },
      );
    }
  }
}

async function drive(owner: Owner): Promise<void> {
  if (owner.stopped) return;
  if (
    owner.connected &&
    state.driver?.isConnected &&
    !state.driver.isConnected(owner.sessionId, owner.lease)
  ) {
    await retire(owner);
    return;
  }
  if (Date.now() - owner.renewedAt >= (WRITER_TTL_SECONDS * 1_000) / 3) {
    const renewed = await renewWriterLease(
      owner.sessionId,
      owner.lease,
      WRITER_TTL_SECONDS,
      owner.scope,
    );
    if (!renewed) {
      await retire(owner, false);
      return;
    }
    owner.renewedAt = Date.now();
  }
  if (!state.host || !state.driver) return;
  if (!owner.connected) {
    const maintained = await expireSessionCommands(owner.sessionId, owner.lease, owner.scope);
    if (!maintained) {
      await retire(owner, false);
      return;
    }
  }
  const runtime = await getJournalRuntime(owner.sessionId, owner.scope);
  if (!runtime) {
    await retire(owner);
    return;
  }
  if (["ended", "failed"].includes(runtime.session.status)) {
    await retire(owner);
    return;
  }
  if (!owner.connected) {
    // During handshake only a proven DB-only cancellation can complete. Do
    // not consume permission/input commands before their remote handlers exist.
    for (const command of await loadSessionCommands(owner.sessionId, owner.scope)) {
      if (command.kind !== "cancel" || command.state !== "queued") continue;
      const claimed = await transitionSessionCommand(
        owner.sessionId,
        command.commandId,
        ["queued"],
        "claimed",
        owner.lease,
        owner.scope,
      );
      if (claimed && !(await cancelUndispatched(owner, command)))
        await transitionSessionCommand(
          owner.sessionId,
          command.commandId,
          ["claimed"],
          "queued",
          owner.lease,
          owner.scope,
        );
    }
    return;
  }
  await reconcile(owner);
  // Idle owners have no command state to expire or claim. Avoid two empty
  // locking transactions per scan, without weakening the real claim fence.
  const pending = await hasPendingSessionCommands(owner.sessionId, owner.scope);
  if (pending && owner.connected && !owner.data && owner.controls.size === 0) {
    const commands = await claimSessionCommands(owner.sessionId, owner.lease, owner.scope, "data");
    const command = commands[0];
    if (command) {
      owner.dataCommandId = command.commandId;
      owner.data = execute(owner, command).finally(() => {
        owner.data = null;
        owner.dataCommandId = undefined;
      });
      void owner.data.catch((error) =>
        logOwner(owner, "supervisor_execution_failed", "failed", error),
      );
    }
  }
  if (pending && owner.controls.size === 0) {
    const commands = await claimSessionCommands(
      owner.sessionId,
      owner.lease,
      owner.scope,
      "control",
    );
    for (const command of commands.slice(0, MAX_CONTROLS - owner.controls.size)) {
      const operation = execute(owner, command).finally(() =>
        owner.controls.delete(command.commandId),
      );
      owner.controls.set(command.commandId, operation);
      void operation.catch((error) =>
        logOwner(owner, "supervisor_control_failed", "failed", error),
      );
    }
  }
  const demandUntil = runtime.demandUntil ? new Date(runtime.demandUntil).getTime() : 0;
  if (
    !owner.data &&
    !owner.controls.size &&
    (!runtime.activeCommandId || runtime.session.reliability?.execution === "unknown") &&
    demandUntil < Date.now()
  )
    await retire(owner);
}

function confirmedTransientConnectionFailure(error: unknown): boolean {
  const storage = describeAgentSessionStorageError(error);
  if (
    storage.driverCode ||
    storage.sqlState?.startsWith("08") ||
    ["40001", "40P01", "55P03", "57014"].includes(storage.sqlState ?? "")
  )
    return true;
  try {
    return Boolean(
      error &&
        typeof error === "object" &&
        Reflect.get(error, journalSynchronizationErrorBrand) === true &&
        Reflect.get(error, "outcome") === "transient_failure",
    );
  } catch {
    return false;
  }
}

async function freezeConnectionFailure(owner: Owner, diagnosticRef: string): Promise<void> {
  const saved = await updateJournalRuntime(
    owner.sessionId,
    { connectionState: "disconnected", syncState: "gap", diagnosticRef },
    owner.lease,
    owner.scope,
  );
  if (!saved) return;
  for (const command of await loadSessionCommands(owner.sessionId, owner.scope)) {
    if (["queued", "claimed"].includes(command.state))
      await transitionSessionCommand(
        owner.sessionId,
        command.commandId,
        ["queued", "claimed"],
        "rejected",
        owner.lease,
        owner.scope,
        { errorCode: "CONNECTION_RETRY_STOPPED" },
      );
    else if (["dispatching", "observed"].includes(command.state))
      await transitionSessionCommand(
        owner.sessionId,
        command.commandId,
        ["dispatching", "observed"],
        "unknown",
        owner.lease,
        owner.scope,
        { errorCode: "DISPATCH_OUTCOME_UNKNOWN" },
      );
  }
  const remaining = await loadSessionCommands(owner.sessionId, owner.scope);
  const uncertain = remaining.some((command) =>
    ["dispatching", "observed", "unknown"].includes(command.state),
  );
  await updateJournalRuntime(
    owner.sessionId,
    { executionState: uncertain ? "unknown" : "idle", ...(uncertain ? {} : { status: "idle" }) },
    owner.lease,
    owner.scope,
  );
}

async function ensureOwner(sessionId: string, scope: AgentSessionScope): Promise<void> {
  const key = ownerKey(sessionId, scope);
  const existing = state.owners.get(key);
  if (existing) {
    await drive(existing);
    return;
  }
  if (!state.driver || state.owners.size >= MAX_OWNERS) return;
  if ((state.retryAfter?.get(key)?.nextAt ?? 0) > Date.now()) return;
  const lease = await claimWriterLease(
    sessionId,
    `writer_${randomUUID()}`,
    WRITER_TTL_SECONDS,
    scope,
  );
  if (!lease) return;
  try {
    if (!(await expireSessionCommands(sessionId, lease, scope))) {
      await releaseWriterLease(sessionId, lease, scope);
      return;
    }
  } catch (error) {
    await releaseWriterLease(sessionId, lease, scope).catch(() => false);
    throw error;
  }
  const runtime = await getJournalRuntime(sessionId, scope);
  if (!runtime || runtime.journalMode !== "supervised") {
    await releaseWriterLease(sessionId, lease, scope);
    return;
  }
  if (
    !runtime.activeCommandId &&
    (!runtime.demandUntil || new Date(runtime.demandUntil).getTime() <= Date.now())
  ) {
    await releaseWriterLease(sessionId, lease, scope);
    return;
  }
  const owner: Owner = {
    sessionId,
    scope: Object.freeze({ ...scope }),
    lease,
    connected: false,
    connecting: null,
    data: null,
    controls: new Map(),
    renewedAt: Date.now(),
    reconciledAt: 0,
    stopped: false,
  };
  state.owners.set(key, owner);
  const stoppedRetry = state.retryAfter?.get(key);
  if (stoppedRetry?.terminal) {
    await freezeConnectionFailure(
      owner,
      stoppedRetry.diagnosticRef ?? `diag_${randomUUID().replaceAll("-", "")}`,
    ).catch(() => undefined);
    await retire(owner).catch(() => undefined);
    return;
  }
  // Never await a remote handshake in the global scanner. Other sessions and
  // active control lanes must make progress while one endpoint is slow.
  owner.connecting = state.driver
    .connect(runtime, lease, scope)
    .then(async () => {
      if (!owner.stopped) {
        owner.connected = true;
        state.retryAfter?.delete(key);
      }
    })

    .catch(async (error: unknown) => {
      if (owner.stopped) return;
      const diagnosticRef = `diag_${randomUUID().replaceAll("-", "")}`;
      const failures = (state.retryAfter?.get(key)?.failures ?? 0) + 1;
      const terminal = !confirmedTransientConnectionFailure(error) || failures >= 6;
      state.retryAfter?.set(key, {
        failures,
        terminal,
        diagnosticRef,
        nextAt:
          Date.now() +
          Math.min(30_000, 1_000 * 2 ** Math.min(5, failures - 1)) +
          Math.floor(Math.random() * 100),
      });
      if ((state.retryAfter?.size ?? 0) > 500) {
        const oldest = state.retryAfter?.keys().next().value;
        if (oldest !== undefined) state.retryAfter?.delete(oldest);
      }
      logOwner(
        owner,
        "supervisor_connect_failed",
        terminal ? "gap" : "retrying",
        error,
        diagnosticRef,
      );
      if (terminal) await freezeConnectionFailure(owner, diagnosticRef).catch(() => undefined);
      else {
        const failedRuntime = await getJournalRuntime(sessionId, scope).catch(() => null);
        await updateJournalRuntime(
          sessionId,
          {
            diagnosticRef: failedRuntime?.session.reliability?.diagnosticRef ?? diagnosticRef,
            connectionState: "disconnected",
            syncState:
              failedRuntime?.session.reliability?.synchronization === "gap" ? "gap" : "degraded",
          },
          lease,
          scope,
        ).catch(() => false);
      }
      await retire(owner).catch(() => undefined);
    })
    .finally(() => {
      owner.connecting = null;
    });
}

export function wakeAgentSessionSupervisor(): Promise<void> {
  if (!state.host || !state.driver || state.stopping || !agentSessionSupervisorRequested())
    return Promise.resolve();
  if (state.ticking) return state.ticking;
  const host = state.host;
  state.ticking = (async () => {
    const db = await host.database();
    for (const [key, demand] of state.demand) {
      if (demand.references <= 0) {
        state.demand.delete(key);
        continue;
      }
      if (Date.now() - demand.touchedAt < 10_000) continue;
      demand.touchedAt = Date.now();
      const sessionId = JSON.parse(key)[2] as string;
      await host
        .runAs(demand.scope, () => touchJournalDemand(sessionId, demand.scope))
        .catch(() => undefined);
    }
    const demanded = await listSessionCommandDemand(
      db as Parameters<typeof listSessionCommandDemand>[0],
      MAX_OWNERS,
      true,
    );
    // Reserve this scan's free slots before starting asynchronous lease claims.
    // Every candidate otherwise sees the same owners.size before any claim
    // finishes, allowing a partially occupied host to exceed MAX_OWNERS.
    const scopes = new Map<string, { sessionId: string } & AgentSessionScope>();
    for (const owner of state.owners.values())
      scopes.set(ownerKey(owner.sessionId, owner.scope), {
        sessionId: owner.sessionId,
        ...owner.scope,
      });
    let available = Math.max(0, MAX_OWNERS - state.owners.size);
    for (const ref of demanded) {
      const key = ownerKey(ref.sessionId, ref);
      if (scopes.has(key)) continue;
      if (available === 0) break;
      scopes.set(key, ref);
      available -= 1;
    }
    await Promise.allSettled(
      [...scopes.values()].map((ref) =>
        host
          .runAs(ref, () => ensureOwner(ref.sessionId, ref))
          .catch(async (error: unknown) => {
            const owner = state.owners.get(ownerKey(ref.sessionId, ref));
            if (isAgentSessionSupervisorAuthorizationError(error)) {
              await runWithBusabaseContext(
                { db, spaceId: ref.spaceId, actorId: ref.actorId ?? undefined },
                async () => {
                  const lease =
                    owner?.lease ??
                    (await claimWriterLease(
                      ref.sessionId,
                      `cleanup_${randomUUID()}`,
                      WRITER_TTL_SECONDS,
                      ref,
                    ));
                  if (!lease) return;
                  const commands = await loadSessionCommands(ref.sessionId, ref);
                  let unknown = false;
                  for (const command of commands) {
                    if (["queued", "claimed"].includes(command.state))
                      await transitionSessionCommand(
                        ref.sessionId,
                        command.commandId,
                        ["queued", "claimed"],
                        "rejected",
                        lease,
                        ref,
                        { errorCode: "ACTOR_ACCESS_REVOKED" },
                      );
                    else if (["dispatching", "observed", "unknown"].includes(command.state)) {
                      unknown = true;
                      await transitionSessionCommand(
                        ref.sessionId,
                        command.commandId,
                        ["dispatching", "observed"],
                        "unknown",
                        lease,
                        ref,
                        { errorCode: "ACTOR_ACCESS_REVOKED" },
                      );
                    }
                  }
                  await updateJournalRuntime(
                    ref.sessionId,
                    {
                      connectionState: "disconnected",
                      syncState: "degraded",
                      executionState: unknown ? "unknown" : "idle",
                    },
                    lease,
                    ref,
                  );
                  await releaseWriterLease(ref.sessionId, lease, ref);
                },
              ).catch(() => undefined);
            }

            if (owner) {
              logOwner(owner, "supervisor_scope_failed", "rejected", error);
              // Authorization failure never borrows old credentials to keep running.
              state.driver?.detach(owner.sessionId, owner.lease);
              owner.stopped = true;
              state.owners.delete(ownerKey(ref.sessionId, ref));
            }
          }),
      ),
    );
  })()
    .catch((error: unknown) => {
      logAgentSessionDiagnostic(
        "supervisor_scan_failed",
        { stage: "supervisor", outcome: "failed" },
        { level: "warn", error },
      );
    })
    .finally(() => {
      state.ticking = undefined;
    });
  return state.ticking;
}

/** A bounded reference per logical session, not a persistent row per tab. */
export async function retainAgentSessionDemand(
  sessionId: string,
  scope: AgentSessionScope,
): Promise<() => void> {
  assertAgentSessionSupervisorAvailable();
  await touchJournalDemand(sessionId, scope);
  const key = ownerKey(sessionId, scope);
  const entry = state.demand.get(key) ?? {
    scope: Object.freeze({ ...scope }),
    references: 0,
    touchedAt: Date.now(),
  };
  entry.references += 1;
  state.demand.set(key, entry);
  void wakeAgentSessionSupervisor();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.references -= 1;
    if (entry.references <= 0) state.demand.delete(key);
  };
}

export async function stopAgentSessionSupervisorHost(): Promise<void> {
  state.stopping = true;
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
  await state.ticking;
  const host = state.host;
  if (host)
    await Promise.allSettled(
      [...state.owners.values()].map((owner) => host.runAs(owner.scope, () => retire(owner))),
    );
  state.demand.clear();
}

/** Next owns process termination; this hook starts supervisor drain alongside it. */
export function installAgentSessionSupervisorShutdown(): void {
  if (state.shutdownInstalled) return;
  state.shutdownInstalled = true;
  const drain = () => {
    void stopAgentSessionSupervisorHost().catch((error: unknown) => {
      logAgentSessionDiagnostic(
        "supervisor_shutdown_failed",
        {
          stage: "supervisor",
          outcome: "failed",
        },
        { level: "warn", error, force: true },
      );
    });
  };
  process.once("SIGTERM", drain);
  process.once("SIGINT", drain);
}

export const isAgentSessionControlCommand = (kind: AgentSessionCommandKind): boolean =>
  ["cancel", "permission", "input", "close"].includes(kind);
