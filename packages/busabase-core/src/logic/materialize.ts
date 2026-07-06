import type { FieldType } from "busabase-contract/types";
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
    name: string;
    type?: FieldType;
    required?: boolean;
    options?: Record<string, unknown>;
  }>;
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
