import {
  type BusabaseClient,
  type BusabaseConfig,
  createBusabaseClient,
  type ResolvedConfig,
  resolveConfig,
} from "./client.js";

// The cloud contract, exported as both a value and a type. The value lets tooling
// introspect the procedure tree (e.g. busabase-cli auto-generates one command per
// procedure by walking it); the type parameterizes the client.
export { type CloudContract, cloudContract } from "busabase-contract/contract/cloud";
export type { CreatableNodeType } from "busabase-contract/domains";
export { CREATABLE_NODE_TYPES } from "busabase-contract/domains";
// Re-export the full VO / DTO type surface so consumers can type their own code
// against Busabase objects (BaseVO, RecordVO, ChangeRequestVO, …) without
// depending on the internal workspace `busabase-contract` package.
export type * from "busabase-contract/types";
export {
  type BusabaseClient,
  type BusabaseConfig,
  type BusabaseRpcConfig,
  createBusabaseClient,
  createBusabaseRpcClient,
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
  get assets(): BusabaseClient["assets"] {
    return this.client.assets;
  }
  get skills(): BusabaseClient["skills"] {
    return this.client.skills;
  }
  get drives(): BusabaseClient["drives"] {
    return this.client.drives;
  }
  get files(): BusabaseClient["files"] {
    return this.client.files;
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
  get webhooks(): BusabaseClient["webhooks"] {
    return this.client.webhooks;
  }

  /** Full-text search across records, change requests, and Bases. */
  search(input: Parameters<BusabaseClient["search"]>[0]) {
    return this.client.search(input);
  }

  /**
   * Unified grep — one regex/literal pattern scanned across every in-scope
   * source (Drive/Skill files, Doc bodies, and Base records — records read
   * the canonical `headCommit.fields`, never the truncated search
   * projection), with a shared `maxMatches`/deadline budget and per-source
   * honest coverage. Use this when the answer could live anywhere; use
   * `client.assets.grep` directly instead when you specifically only care
   * about files and want its fuller `missing`/`stale`/`unsearchable`
   * file-only reporting.
   */
  grep(input: Parameters<BusabaseClient["grep"]>[0]) {
    return this.client.grep(input);
  }

  /**
   * Supply text for an Asset's Drive Grep Retrieval text slot in one call —
   * inline for small text, a presigned upload for large text — so callers
   * never see the underlying three-step flow
   * (`createTextUploadUrl` → PUT bytes → `putText({ storageKey })`).
   *
   * @example
   * ```ts
   * await bb.putText(assetId, extractedText); // picks inline vs presigned by size
   * ```
   */
  async putText(
    assetId: string,
    text: string,
  ): Promise<Awaited<ReturnType<BusabaseClient["assets"]["putText"]>>> {
    // Mirrors the server's INLINE_TEXT_MAX_BYTES cap (1MB) — see
    // packages/busabase-core/src/domains/assets/logic/asset-texts-logic.ts.
    const INLINE_TEXT_MAX_BYTES = 1024 * 1024;
    const byteLength =
      typeof Buffer !== "undefined" ? Buffer.byteLength(text, "utf8") : new Blob([text]).size;
    if (byteLength <= INLINE_TEXT_MAX_BYTES) {
      return this.client.assets.putText({ assetId, text });
    }
    const upload = await this.client.assets.createTextUploadUrl({
      assetId,
      sizeBytes: byteLength,
    });
    const doFetch = this.config.fetch ?? fetch;
    const response = await doFetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: text,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `putText: presigned upload failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`,
      );
    }
    return this.client.assets.putText({ assetId, storageKey: upload.storageKey });
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
