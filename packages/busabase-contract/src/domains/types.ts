/**
 * Shared interfaces for node-type modules. Each node type lives in its own module
 * (./folder, ./base, ./skill, …) and exports a definition that satisfies
 * `NodeTypeDefinition`; the registry composes + registers them.
 */

export interface NodeCapabilities {
  /** Can hold children / renders as an expandable container (folder, future space/section). */
  container?: boolean;
  /** Has a detail screen + route (base, skill, doc; not folder). */
  hasDetail?: boolean;
  /** Can be created via a node change request. */
  creatable?: boolean;
  /**
   * Hidden from the workbench UI (sidebar node tree + create menu) while the
   * backend stays fully active — the type is still registered, its contract /
   * REST endpoints / detail route all work, it just has no visible entry point.
   */
  hidden?: boolean;
}

export interface OperationMeta {
  label: string;
  /** Tailwind class string for the web badge tone. */
  tone: string;
}

export interface OperationDefinition extends OperationMeta {
  kind: string;
}

export interface NodeTypeDefinition {
  type: string;
  label: string;
  /** Platform-neutral icon id; each renderer maps it to a concrete icon component. */
  icon: string;
  capabilities: NodeCapabilities;
  /** Type-specific operations this node contributes (excludes the generic node_* tree ops). */
  operations: readonly OperationDefinition[];
}
