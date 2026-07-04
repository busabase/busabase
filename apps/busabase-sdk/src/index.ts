import {
  type BusabaseClient,
  type BusabaseConfig,
  createBusabaseClient,
  type ResolvedConfig,
  resolveConfig,
} from "./client.js";

export type { CloudContract } from "busabase-contract/contract/cloud";

// Re-export the full VO / DTO type surface so consumers can type their own code
// against Busabase objects (BaseVO, RecordVO, ChangeRequestVO, …) without
// depending on the internal workspace `busabase-contract` package.
export type * from "busabase-contract/types";
export {
  type BusabaseClient,
  type BusabaseConfig,
  createBusabaseClient,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  type ResolvedConfig,
  resolveConfig,
} from "./client.js";

/**
 * Ergonomic entry point to the Busabase API — a thin, fully-typed wrapper around
 * {@link createBusabaseClient}. Prefer this when you want a single object with
 * grouped, namespaced methods; drop to `.client` for the raw oRPC client.
 *
 * @example
 * ```ts
 * import { Busabase } from "busabase-sdk";
 *
 * const bb = new Busabase({ apiKey: process.env.BUSABASE_API_KEY });
 *
 * await bb.health();                       // { status, timestamp }
 * const bases = await bb.bases.list();
 * const record = await bb.records.get({ recordId });
 * const cr = await bb.changeRequests.merge({ changeRequestId });
 * ```
 *
 * All fields default from `BUSABASE_BASE_URL` / `BUSABASE_API_KEY` /
 * `BUSABASE_SPACE_ID` when omitted.
 */
export class Busabase {
  /** The underlying fully-typed oRPC client. Use it for anything not surfaced here. */
  readonly client: BusabaseClient;
  /** The config after env / default resolution (base URL, presence of a key, space). */
  readonly config: ResolvedConfig;

  constructor(config: BusabaseConfig = {}) {
    this.config = resolveConfig(config);
    this.client = createBusabaseClient(this.config);
  }

  // Namespaced domain surfaces — delegate to the raw client so callers get the
  // exact same typing as `client.<ns>` but through a single `Busabase` instance.
  get bases(): BusabaseClient["bases"] {
    return this.client.bases;
  }
  get records(): BusabaseClient["records"] {
    return this.client.records;
  }
  get views(): BusabaseClient["views"] {
    return this.client.views;
  }
  get changeRequests(): BusabaseClient["changeRequests"] {
    return this.client.changeRequests;
  }
  get operations(): BusabaseClient["operations"] {
    return this.client.operations;
  }
  get nodes(): BusabaseClient["nodes"] {
    return this.client.nodes;
  }
  get comments(): BusabaseClient["comments"] {
    return this.client.comments;
  }
  get auditEvents(): BusabaseClient["auditEvents"] {
    return this.client.auditEvents;
  }
  get agent(): BusabaseClient["agent"] {
    return this.client.agent;
  }
  get attachments(): BusabaseClient["attachments"] {
    return this.client.attachments;
  }
  get skills(): BusabaseClient["skills"] {
    return this.client.skills;
  }
  get docs(): BusabaseClient["docs"] {
    return this.client.docs;
  }
  get folders(): BusabaseClient["folders"] {
    return this.client.folders;
  }
  get agentTasks(): BusabaseClient["agentTasks"] {
    return this.client.agentTasks;
  }

  /** Full-text search across records, change requests, and Bases. */
  search(input: Parameters<BusabaseClient["search"]>[0]) {
    return this.client.search(input);
  }

  /** Service health — reaches the server without requiring auth. */
  health() {
    return this.client.system.health();
  }

  /** The authenticated user behind the configured API key (cloud only). */
  me() {
    return this.client.users.me();
  }
}
