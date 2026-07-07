/**
 * Node-type registry. Each node type is its own module (./folder, ./base,
 * ./skill, …); this file **registers** them and derives everything else.
 *
 * Nothing is pre-listed: `NODE_TYPES`, `OPERATION_KINDS`, `OperationKind`,
 * `NodeType`, `CREATABLE_NODE_TYPES`, and `OPERATION_META` are all derived from
 * the registered definitions. To add a type: create a module and register it in
 * `BUILTIN_NODE_TYPES` (or, for a build-time plugin package, call
 * `registerNodeType()` at import time).
 *
 * Registration is compile-time assembly of `BUILTIN_NODE_TYPES`, which keeps full
 * literal types (so `z.enum(NODE_TYPES)` stays exhaustively typed). The runtime
 * `registry` Map also accepts late `registerNodeType()` calls so build-time plugin
 * modules are discoverable at runtime (string-typed on the runtime side).
 *
 * Dependency-free so it can sit at the base of the dependency graph.
 */

import { baseNodeType } from "./base/definition";
import { docNodeType } from "./doc/definition";
import { driveNodeType } from "./drive/definition";
import { folderNodeType } from "./folder/definition";
import { skillNodeType } from "./skill/definition";
import type {
  NodeCapabilities,
  NodeTypeDefinition,
  OperationDefinition,
  OperationMeta,
} from "./types";

export type {
  NodeCapabilities,
  NodeTypeDefinition,
  OperationDefinition,
  OperationMeta,
} from "./types";

// Generic tree operations owned by the kernel — they act on any node row.
const GENERIC_NODE_OPERATIONS = [
  {
    kind: "node_create",
    label: "Create node",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  { kind: "node_rename", label: "Rename node", tone: "border-sky-200 bg-sky-50 text-sky-800" },
  { kind: "node_delete", label: "Delete node", tone: "border-red-200 bg-red-50 text-red-800" },
  {
    kind: "node_restore",
    label: "Restore node",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  { kind: "node_move", label: "Move node", tone: "border-indigo-200 bg-indigo-50 text-indigo-800" },
] as const;

// --- Registration -------------------------------------------------------------

const registry = new Map<string, NodeTypeDefinition>();

/** Register a node type. First-party modules are registered below; build-time
 *  plugin packages can call this at import time to add their own. */
export function registerNodeType(definition: NodeTypeDefinition): void {
  registry.set(definition.type, definition);
}

/** The first-party node-type modules, in display order. The compile-time source
 *  of truth from which the static types are derived. */
export const BUILTIN_NODE_TYPES = [
  folderNodeType,
  baseNodeType,
  skillNodeType,
  driveNodeType,
  docNodeType,
] as const;

for (const definition of BUILTIN_NODE_TYPES) {
  registerNodeType(definition);
}

// --- Derived node types -------------------------------------------------------

type BuiltinDefinition = (typeof BUILTIN_NODE_TYPES)[number];

export type NodeType = BuiltinDefinition["type"];
export const NODE_TYPES = BUILTIN_NODE_TYPES.map((definition) => definition.type) as [
  NodeType,
  ...NodeType[],
];

export type CreatableNodeType = Extract<
  BuiltinDefinition,
  { capabilities: { creatable: true } }
>["type"];
export const CREATABLE_NODE_TYPES = BUILTIN_NODE_TYPES.filter((definition) =>
  Boolean((definition.capabilities as NodeCapabilities).creatable),
).map((definition) => definition.type) as [CreatableNodeType, ...CreatableNodeType[]];

// --- Derived operation kinds --------------------------------------------------

type GenericOperationKind = (typeof GENERIC_NODE_OPERATIONS)[number]["kind"];
type RegisteredOperationKind = BuiltinDefinition["operations"][number]["kind"];
export type OperationKind = GenericOperationKind | RegisteredOperationKind;

const ALL_OPERATIONS: readonly OperationDefinition[] = [
  ...GENERIC_NODE_OPERATIONS,
  ...BUILTIN_NODE_TYPES.flatMap(
    (definition) => definition.operations as readonly OperationDefinition[],
  ),
];

export const OPERATION_KINDS = ALL_OPERATIONS.map((operation) => operation.kind) as [
  OperationKind,
  ...OperationKind[],
];

/** Generic kernel tree operations (act on any node, regardless of type). */
export const GENERIC_NODE_OPERATION_KINDS = GENERIC_NODE_OPERATIONS.map(
  (operation) => operation.kind,
) as [GenericOperationKind, ...GenericOperationKind[]];

export const OPERATION_META = Object.fromEntries(
  ALL_OPERATIONS.map((operation) => [
    operation.kind,
    { label: operation.label, tone: operation.tone },
  ]),
) as Record<OperationKind, OperationMeta>;

export const getOperationMeta = (kind: string): OperationMeta | undefined =>
  OPERATION_META[kind as OperationKind];

// --- Lookups (runtime registry, so plugin-registered types resolve too) -------

export const listNodeTypes = (): NodeTypeDefinition[] => [...registry.values()];

export const getNodeType = (type: string): NodeTypeDefinition | undefined => registry.get(type);

export const hasCapability = (type: string, capability: keyof NodeCapabilities): boolean =>
  Boolean(getNodeType(type)?.capabilities[capability]);
