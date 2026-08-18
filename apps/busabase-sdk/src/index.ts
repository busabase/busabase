import type { ChangeRequestVO, RecordVO, ViewVO } from "busabase-contract/types";
import { type BusabaseAssetsClient, grepAssets } from "./asset-grep.js";
import {
  type BusabaseClient,
  type BusabaseConfig,
  createBusabaseClient,
  type ResolvedConfig,
  resolveConfig,
} from "./client.js";
import { type BusabaseRecordsClient, getRecordByField } from "./record-get.js";

type RawChangeRequestsClient = BusabaseClient["changeRequests"];
type ReviewBatchInput = Parameters<RawChangeRequestsClient["review"]>[0];
type MergeBatchInput = Parameters<RawChangeRequestsClient["merge"]>[0];

interface ChangeRequestActionClient {
  review(
    input: Omit<ReviewBatchInput, "changeRequestIds"> & { changeRequestId: string },
  ): Promise<ChangeRequestVO>;
  review(input: ReviewBatchInput): ReturnType<RawChangeRequestsClient["review"]>;
  merge(input: {
    changeRequestId: string;
  }): Promise<{ changeRequest: ChangeRequestVO; record: RecordVO | null; view: ViewVO | null }>;
  merge(input: MergeBatchInput): ReturnType<RawChangeRequestsClient["merge"]>;
}

export type BusabaseChangeRequestsClient = Omit<RawChangeRequestsClient, "review" | "merge"> &
  ChangeRequestActionClient;

const batchItemError = (result: { error?: string; code?: string; data?: unknown } | undefined) =>
  Object.assign(new Error(result?.error ?? "Change request action returned no result"), {
    ...(result?.code ? { code: result.code } : {}),
    ...(result?.data === undefined ? {} : { data: result.data }),
  });

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
  type BusabaseAssetsClient,
  grepAssets,
  toFilesOnlyGrepResult,
  toUnifiedFilesGrepInput,
} from "./asset-grep.js";
export {
  type BusabaseClient,
  type BusabaseConfig,
  createBusabaseClient,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  type ResolvedConfig,
  resolveConfig,
} from "./client.js";
export {
  type BusabaseRecordsClient,
  getRecordByField,
  type RecordByFieldInput,
} from "./record-get.js";
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
  get records(): BusabaseRecordsClient {
    const getByField = (input: Parameters<BusabaseRecordsClient["getByField"]>[0]) =>
      getRecordByField(this.client, input);
    return new Proxy(this.client.records, {
      get(target, property, receiver) {
        if (property === "getByField") return getByField;
        return Reflect.get(target, property, receiver);
      },
    }) as BusabaseRecordsClient;
  }
  get views(): BusabaseClient["views"] {
    return this.client.views;
  }
  get changeRequests(): BusabaseChangeRequestsClient {
    const review = async (
      input:
        | ReviewBatchInput
        | (Omit<ReviewBatchInput, "changeRequestIds"> & { changeRequestId: string }),
    ) => {
      if ("changeRequestIds" in input) return this.client.changeRequests.review(input);
      const { changeRequestId, ...reviewInput } = input;
      const { results } = await this.client.changeRequests.review({
        ...reviewInput,
        changeRequestIds: [changeRequestId],
      });
      const result = results[0];
      if (!result?.ok) throw batchItemError(result);
      return result.changeRequest;
    };
    const merge = async (input: MergeBatchInput | { changeRequestId: string }) => {
      if ("changeRequestIds" in input) return this.client.changeRequests.merge(input);
      const { results } = await this.client.changeRequests.merge({
        changeRequestIds: [input.changeRequestId],
      });
      const result = results[0];
      if (!result?.ok) throw batchItemError(result);
      return {
        changeRequest: result.changeRequest,
        record: result.record,
        view: result.view,
      };
    };
    return new Proxy(this.client.changeRequests, {
      get(target, property, receiver) {
        if (property === "review") return review;
        if (property === "merge") return merge;
        return Reflect.get(target, property, receiver);
      },
    }) as BusabaseChangeRequestsClient;
  }
  get operations(): BusabaseClient["operations"] {
    return this.client.operations;
  }
  /**
   * The workspace node surface, and the single entry point for reading ONE node
   * of any type: `bb.nodes.get({ nodeId })` returns a `NodeDetailVO`
   * discriminated by `type` (`folder` carries `children`, `doc` a `body`, `file`
   * its `asset`, `skill`/`drive`/`airapp` their `files`). It replaced the four
   * typed gets (`docs`/`files`/`folders`/`fileTrees`), so a caller holding an id
   * no longer has to know the node's type before it can read it.
   *
   * `bb.nodes.list({ types })` is the matching list: a flat array of lightweight
   * summaries for just those types. Without `types` it still returns the full
   * workspace tree.
   *
   * There is no `bb.folders` any more — folders are `type: "folder"` here.
   */
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
  get assets(): BusabaseAssetsClient {
    const filesOnlyGrep = (input: Parameters<BusabaseAssetsClient["grep"]>[0]) =>
      grepAssets(this.client, input);
    return new Proxy(this.client.assets, {
      get(target, property, receiver) {
        if (property === "grep") return filesOnlyGrep;
        return Reflect.get(target, property, receiver);
      },
    }) as BusabaseAssetsClient;
  }
  /**
   * Skills, Drives, and AirApps — one surface, discriminated by `type`.
   *
   * Creation and per-file reads/writes live here. Listing them and reading one
   * node's detail moved to the unified Node surface:
   * `bb.nodes.list({ types: ["skill", "drive", "airapp"] })` and
   * `bb.nodes.get({ nodeId, type })`.
   */
  get fileTrees(): BusabaseClient["fileTrees"] {
    return this.client.fileTrees;
  }
  /**
   * File nodes. `create` only — list with `bb.nodes.list({ types: ["file"] })`
   * and read one (backing Asset included) with `bb.nodes.get({ nodeId })`.
   */
  get files(): BusabaseClient["files"] {
    return this.client.files;
  }
  /**
   * Docs. Create / read a line range / update the body / open a Change Request.
   * List with `bb.nodes.list({ types: ["doc"] })` and read one (body included)
   * with `bb.nodes.get({ nodeId })`.
   *
   * There is deliberately no `bb.docs.list()` shim. The retired `GET /docs`
   * returned every Doc *with its body*; the one-call replacement returns
   * lightweight summaries, and the only way to keep the old shape would be a
   * detail request per Doc. An SDK convenience that quietly turns one call into
   * N is worse than a compile error that points at `bb.nodes`.
   */
  get docs(): BusabaseClient["docs"] {
    return this.client.docs;
  }
  get agentTasks(): BusabaseClient["agentTasks"] {
    return this.client.agentTasks;
  }
  get webhooks(): BusabaseClient["webhooks"] {
    return this.client.webhooks;
  }
  get embedLinks(): BusabaseClient["embedLinks"] {
    return this.client.embedLinks;
  }

  /** Full-text search across records, change requests, and Bases. */
  search(input: Parameters<BusabaseClient["search"]>[0]) {
    return this.client.search(input);
  }

  /**
   * Unified grep — one regex/literal pattern scanned across every in-scope
   * source (Drive/Skill files, Doc bodies, and Base records — records read
   * the canonical `headCommit.payload`, never the truncated search
   * projection), with a shared `maxMatches`/deadline budget and per-source
   * honest coverage. `bb.assets.grep` remains available as a files-only SDK
   * convenience and delegates here with `sources: ["files"]`.
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
