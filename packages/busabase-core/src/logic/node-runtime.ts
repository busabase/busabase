import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { NodePO } from "../db/schema";
import type { MergeCtx } from "./store";

/**
 * Server-side behaviour registry for node types — the core-side half of a node
 * type's definition.
 *
 * The other half lives in `busabase-contract`'s `registerNodeType`: declarations
 * (label, icon, capabilities, operations, schemas). That module is PURE ZOD and
 * ships in the browser bundle, so nothing here can live there — a hydrator
 * touches `~/db` and object storage, and hanging it off the contract definition
 * would drag the server into every client.
 *
 * So: two registries, one per runtime, keyed by the same `type` string. A node
 * type declares itself in the contract and registers its behaviour here.
 *
 * ## Registration must be guaranteed by the consumer, not left to chance
 *
 * A registry populated by import side effects only works if something imports
 * the modules. This repo has already paid for getting that wrong: `node_create`
 * for a Skill/Drive/AirApp silently fell back to the generic materializer and
 * produced a node with zero files, because the merge kernel assumed "whoever
 * else happened to import them" had run.
 *
 * The fix is `./builtin-node-runtimes` — ONE barrel of side-effect imports that
 * every consumer of this registry imports. Adding a builtin node type means
 * adding one line there, not remembering every dispatch site.
 */

export interface NodeRuntime {
  /**
   * Hydrate this type's typed detail for `GET /nodes/{nodeId}`.
   *
   * Omit it to get the generic `{ type, node }` shape — correct for a type whose
   * detail is just the node row (base, form). The ACL and the anonymous-visitor
   * gate have already run by the time this is called; see `logic/node-detail.ts`
   * for why that order is the security property of that file.
   */
  hydrateDetail?: (node: NodePO) => Promise<NodeDetailVO>;

  /**
   * Opt in to the generic `{ type, node }` detail shape — correct for a type
   * whose detail is just the node row (base, form).
   *
   * Deliberately an EXPLICIT opt-in rather than the fallback for "no hydrator
   * registered". The table this replaced documented itself as failing closed:
   * it threw for an unknown type rather than "returning a partial or
   * mis-discriminated VO that a client would have to guess at". Making generic
   * the silent default would quietly drop that property, so a type that
   * registers nothing at all still fails closed.
   */
  genericDetail?: true;

  /**
   * Materialize a newly created node of this type at `node_create` merge time.
   *
   * Returns the created node id (a Base materializes its own node, so the id can
   * differ from the caller's). Omit it for a type whose creation is just the node
   * row. Registered through `registerMaterializer` today — see `./materialize`.
   */
  materialize?: (
    ctx: MergeCtx,
    args: { parentNode: NodePO; fields: Record<string, unknown> },
  ) => Promise<string>;
}

const runtimes = new Map<string, NodeRuntime>();

/**
 * Register (or extend) a node type's server-side behaviour.
 *
 * Merges into any existing entry rather than replacing it, so a type can
 * register its capabilities from more than one module — the file-tree family
 * registers three types from one factory, and a domain may want its hydrator
 * and its materializer to live in different files.
 */
export const registerNodeRuntime = (type: string, runtime: NodeRuntime): void => {
  const existing = runtimes.get(type);
  runtimes.set(type, existing ? { ...existing, ...runtime } : runtime);
};

export const getNodeRuntime = (type: string): NodeRuntime | undefined => runtimes.get(type);

/** Every type that has registered behaviour. Test/diagnostic use. */
export const registeredNodeRuntimeTypes = (): string[] => [...runtimes.keys()].sort();
