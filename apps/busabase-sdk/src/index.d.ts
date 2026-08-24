import type { ChangeRequestVO, RecordVO, ViewVO } from "busabase-contract/types";
import { type BusabaseAssetsClient } from "./asset-grep.js";
import { type BusabaseClient, type BusabaseConfig, type ResolvedConfig } from "./client.js";
import { type BusabaseRecordsClient } from "./record-get.js";
type RawChangeRequestsClient = BusabaseClient["changeRequests"];
type ReviewBatchInput = Parameters<RawChangeRequestsClient["review"]>[0];
type MergeBatchInput = Parameters<RawChangeRequestsClient["merge"]>[0];
interface ChangeRequestActionClient {
  review(
    input: Omit<ReviewBatchInput, "changeRequestIds"> & {
      changeRequestId: string;
    },
  ): Promise<ChangeRequestVO>;
  review(input: ReviewBatchInput): ReturnType<RawChangeRequestsClient["review"]>;
  merge(input: { changeRequestId: string }): Promise<{
    changeRequest: ChangeRequestVO;
    record: RecordVO | null;
    view: ViewVO | null;
  }>;
  merge(input: MergeBatchInput): ReturnType<RawChangeRequestsClient["merge"]>;
}
export type BusabaseChangeRequestsClient = Omit<RawChangeRequestsClient, "review" | "merge"> &
  ChangeRequestActionClient;
export { type CloudContract, cloudContract } from "busabase-contract/contract/cloud";
export type { CreatableNodeType } from "busabase-contract/domains";
export { CREATABLE_NODE_TYPES } from "busabase-contract/domains";
export { type NodeWebUrlInput, nodeWebUrl } from "busabase-contract/node-web-url";
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
export declare class Busabase {
  /** The underlying fully-typed oRPC client. Use it for anything not surfaced here. */
  readonly client: BusabaseClient;
  /** The config after env / default resolution (base URL, presence of a key, space). */
  readonly config: ResolvedConfig;
  constructor(config?: BusabaseConfig);
  get bases(): BusabaseClient["bases"];
  get records(): BusabaseRecordsClient;
  get views(): BusabaseClient["views"];
  get changeRequests(): BusabaseChangeRequestsClient;
  get operations(): BusabaseClient["operations"];
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
  get nodes(): BusabaseClient["nodes"];
  get comments(): BusabaseClient["comments"];
  get auditEvents(): BusabaseClient["auditEvents"];
  get agent(): BusabaseClient["agent"];
  get assets(): BusabaseAssetsClient;
  /**
   * Skills, Drives, and AirApps — one surface, discriminated by `type`.
   *
   * Creation and per-file reads/writes live here. Listing them and reading one
   * node's detail moved to the unified Node surface:
   * `bb.nodes.list({ types: ["skill", "drive", "airapp"] })` and
   * `bb.nodes.get({ nodeId, type })`.
   */
  get fileTrees(): BusabaseClient["fileTrees"];
  /**
   * File nodes. `create` only — list with `bb.nodes.list({ types: ["file"] })`
   * and read one (backing Asset included) with `bb.nodes.get({ nodeId })`.
   */
  get files(): BusabaseClient["files"];
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
  get docs(): BusabaseClient["docs"];
  get agentTasks(): BusabaseClient["agentTasks"];
  get webhooks(): BusabaseClient["webhooks"];
  get embedLinks(): BusabaseClient["embedLinks"];
  /**
   * The canonical dashboard URL a human opens for a node — the link you hand
   * back after a write.
   *
   * Uses `config.webUrl` (which defaults to `baseUrl`) and `config.spaceId`.
   * Pass `spaceId: null` for a workspace-subdomain host, where the route drops
   * the space segment.
   *
   * This is the *authenticated*, durable link: it never expires, but the reader
   * needs a session unless the node has public sharing enabled. For a no-login
   * link, mint a Cloud embed link instead —
   * `bb.embedLinks.create({ nodeId })` returns `{ url, iframeUrl }`.
   *
   * @example
   * ```ts
   * const doc = await bb.docs.create({ ... });
   * bb.nodeUrl({ nodeType: "doc", nodeSlug: doc.slug });
   * // → https://busabase.com/dashboard/org_123/doc/q3-pricing
   * ```
   */
  nodeUrl(input: {
    nodeType: string;
    nodeSlug: string;
    spaceId?: string | null;
    extraSegments?: readonly string[];
  }): string;
  /** Full-text search across records, change requests, and Bases. */
  search(
    input: Parameters<BusabaseClient["search"]>[0],
  ): import("@orpc/client").ClientPromiseResult<
    {
      query: string;
      limit: number;
      offset: number;
      hasMore: boolean;
      results: {
        id: string;
        kind: "base" | "change_request" | "file" | "record";
        title: string;
        body: string;
        eyebrow: string;
        href: string;
        updatedAt: string | null;
      }[];
    },
    Error
  >;
  /**
   * Unified grep — one regex/literal pattern scanned across every in-scope
   * source (Drive/Skill files, Doc bodies, and Base records — records read
   * the canonical `headCommit.payload`, never the truncated search
   * projection), with a shared `maxMatches`/deadline budget and per-source
   * honest coverage. `bb.assets.grep` remains available as a files-only SDK
   * convenience and delegates here with `sources: ["files"]`.
   */
  grep(input: Parameters<BusabaseClient["grep"]>[0]): import("@orpc/client").ClientPromiseResult<
    {
      matches: (
        | {
            line: number;
            column: number;
            text: string;
            before: string[];
            after: string[];
            source: "files";
            assetId: string;
            fileName: string;
            drivePath: string;
          }
        | {
            line: number;
            column: number;
            text: string;
            before: string[];
            after: string[];
            source: "nodes";
            type: "doc" | "html" | "whiteboard" | "workflow";
            nodeId: string;
            slug: string;
            name: string;
          }
        | {
            line: number;
            column: number;
            text: string;
            before: string[];
            after: string[];
            source: "records";
            baseId: string;
            baseSlug: string;
            recordId: string;
            fieldSlug: string;
          }
      )[];
      coverage: {
        files: {
          scanned: number;
          missing: string[];
          stale: string[];
          unsearchable: number;
          errored: string[];
          notReached: number;
        };
        nodes: {
          scanned: number;
          errored: string[];
          notReached: number;
        };
        records: {
          scanned: number;
          errored: string[];
          notReached: number;
        };
      };
      truncated: boolean;
    },
    Error
  >;
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
  putText(
    assetId: string,
    text: string,
  ): Promise<Awaited<ReturnType<BusabaseClient["assets"]["putText"]>>>;
  /** Service health — reaches the server without requiring auth. */
  health(): import("@orpc/client").ClientPromiseResult<
    {
      status: string;
      timestamp: string;
    },
    Error
  >;
  /** The authenticated user behind the configured API key (cloud only). */
  me(): import("@orpc/client").ClientPromiseResult<
    {
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
      image: string | null;
      createdAt: string;
    },
    import("@orpc/contract").ErrorFromErrorMap<
      import("@orpc/contract").MergedErrorMap<
        Record<never, never>,
        import("@orpc/contract").MergedErrorMap<
          Record<never, never>,
          {
            UNAUTHORIZED: {
              status: number;
              message: string;
              data: import("zod").ZodObject<
                {
                  error: import("zod").ZodString;
                },
                import("zod/v4/core").$strip
              >;
            };
          }
        >
      >
    >
  >;
}
