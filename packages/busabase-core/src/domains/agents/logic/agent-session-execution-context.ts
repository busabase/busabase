import { AsyncLocalStorage } from "node:async_hooks";
import type { SupervisedAgentCommand } from "./agent-session-supervisor";

export interface AgentSessionExecutionContext {
  readonly command: SupervisedAgentCommand;
  readonly beforeDispatch: () => Promise<void>;
}

// A retained session callback can originate in instrumentation while the
// active driver was evaluated by an RPC route. Only the storage instance is
// process-global; command values remain scoped to each asynchronous operation.
const executionGlobals = globalThis as typeof globalThis & {
  __busabaseAgentSessionExecutionContextStorage?: AsyncLocalStorage<AgentSessionExecutionContext>;
};
if (!executionGlobals.__busabaseAgentSessionExecutionContextStorage)
  executionGlobals.__busabaseAgentSessionExecutionContextStorage =
    new AsyncLocalStorage<AgentSessionExecutionContext>();

export const supervisedDispatch = executionGlobals.__busabaseAgentSessionExecutionContextStorage;

/** Stable failure identity shared by retained drivers and current scanners. */
export const journalSynchronizationErrorBrand = Symbol.for(
  "busabase.agent-session.journal-synchronization",
);
