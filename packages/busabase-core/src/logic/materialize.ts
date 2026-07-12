import type { FieldType } from "busabase-contract/types";
import type { iString } from "openlib/i18n/i-string";
import type { NodePO } from "../db/schema";
import type { MergeCtx } from "./store";

/**
 * Node-create materialization registry.
 *
 * `node_create` is a generic kernel operation; the kernel creates nothing
 * type-specific itself. Each module that needs extra materialization (a Base row
 * + fields, a Skill's storage files, a doc's content row, …) registers a
 * materializer here, and the kernel's merge dispatcher looks it up by node type.
 * Types with no registered materializer fall back to the generic node row.
 *
 * This is a standalone module (only a type-only import from the kernel) so both
 * the kernel and the domains can import it without a runtime cycle; domains
 * register at import time and the kernel statically imports the domain handlers,
 * so registration is always in place before a merge runs.
 */

export interface NodeCreateFields {
  parentNodeId?: string;
  /** Temp id for THIS node, so later operations in the same CR can reference it. */
  ref?: string;
  /** Reference a node created by an EARLIER operation in the same CR as the parent. */
  parentNodeRef?: string;
  nodeType?: string;
  slug?: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  fields?: Array<{
    slug: string;
    // i18n-capable, matching the contract's fieldNameSchema (a plain string or a
    // locale-keyed record) — the same shape `nodeOperationInputSchema`'s "create"
    // variant already sends through this exact field for the Dashboard's
    // generic node_create path.
    name: iString;
    type?: FieldType;
    required?: boolean;
    options?: Record<string, unknown>;
  }>;
  /**
   * Doc-only: initial body carried through a pending review — set only by
   * `createDoc`'s review-first path (the Dashboard's generic node_create flow
   * never sends one, so `materializeDocNode` falls back to a synthesized
   * default header). Not persisted onto the node row itself.
   */
  body?: string;
  /**
   * Drive/Skill-only: initial file-tree files carried through a pending review
   * — set only by `createFileTreeNode`'s review-first path. Materialized with
   * the same `upsertFileAssetAtPath` the direct-write path uses, applied at
   * merge time instead of immediately, so nothing touches storage until the
   * change request is approved.
   */
  initialFiles?: Array<{
    path: string;
    content?: string;
    assetId?: string;
    displayName?: string;
    mimeType?: string;
  }>;
  /**
   * Drive/Skill/AirApp-only: how `initialFiles` combines with the config's
   * default seed files. "merge" (default): layered on top by path, so a
   * caller supplying just a couple of extra files still gets the rest of the
   * default scaffold. "replace": `initialFiles` replaces the defaults
   * entirely — for a caller handing over a complete, different-shaped
   * project who does not want unrelated default files mixed in.
   */
  mergeMode?: "merge" | "replace";
}

export interface MaterializeArgs {
  parentNode: NodePO;
  fields: NodeCreateFields;
}

/** Materialize a newly-created node of a given type. Returns the created node id
 *  (a Base materializes its own Base node, so the id may differ). */
export type NodeMaterializer = (ctx: MergeCtx, args: MaterializeArgs) => Promise<string>;

const materializers = new Map<string, NodeMaterializer>();

export const registerMaterializer = (type: string, materializer: NodeMaterializer): void => {
  materializers.set(type, materializer);
};

export const getMaterializer = (type: string): NodeMaterializer | undefined =>
  materializers.get(type);
