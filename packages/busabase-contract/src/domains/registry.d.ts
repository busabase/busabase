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
import type { NodeCapabilities, NodeTypeDefinition, OperationMeta } from "./types";
export type {
  NodeCapabilities,
  NodeTypeDefinition,
  OperationDefinition,
  OperationMeta,
} from "./types";
declare const GENERIC_NODE_OPERATIONS: readonly [
  {
    readonly kind: "node_create";
    readonly label: "Create node";
    readonly tone: "border-emerald-200 bg-emerald-50 text-emerald-800";
  },
  {
    readonly kind: "node_rename";
    readonly label: "Rename node";
    readonly tone: "border-sky-200 bg-sky-50 text-sky-800";
  },
  {
    readonly kind: "node_delete";
    readonly label: "Delete node";
    readonly tone: "border-red-200 bg-red-50 text-red-800";
  },
  {
    readonly kind: "node_restore";
    readonly label: "Restore node";
    readonly tone: "border-emerald-200 bg-emerald-50 text-emerald-800";
  },
  {
    readonly kind: "node_move";
    readonly label: "Move node";
    readonly tone: "border-indigo-200 bg-indigo-50 text-indigo-800";
  },
];
/** Register a node type. First-party modules are registered below; build-time
 *  plugin packages can call this at import time to add their own. */
export declare function registerNodeType(definition: NodeTypeDefinition): void;
/** The first-party node-type modules, in display order. The compile-time source
 *  of truth from which the static types are derived. */
export declare const BUILTIN_NODE_TYPES: readonly [
  {
    readonly type: "folder";
    readonly label: "Folder";
    readonly icon: "folder";
    readonly capabilities: {
      readonly container: true;
      readonly creatable: true;
      readonly hasDetail: true;
    };
    readonly operations: readonly [];
  },
  {
    readonly type: "base";
    readonly label: "Base";
    readonly icon: "table";
    readonly capabilities: {
      readonly hasDetail: true;
      readonly creatable: true;
    };
    readonly operations: readonly [
      {
        readonly kind: "record_create";
        readonly label: "Create";
        readonly tone: "border-emerald-200 bg-emerald-50 text-emerald-800";
      },
      {
        readonly kind: "record_update";
        readonly label: "Update";
        readonly tone: "border-sky-200 bg-sky-50 text-sky-800";
      },
      {
        readonly kind: "record_delete";
        readonly label: "Delete";
        readonly tone: "border-red-200 bg-red-50 text-red-800";
      },
      {
        readonly kind: "record_variant";
        readonly label: "Variant";
        readonly tone: "border-violet-200 bg-violet-50 text-violet-800";
      },
      {
        readonly kind: "view_create";
        readonly label: "Create view";
        readonly tone: "border-indigo-200 bg-indigo-50 text-indigo-800";
      },
      {
        readonly kind: "view_update";
        readonly label: "Update view";
        readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
      },
      {
        readonly kind: "view_delete";
        readonly label: "Delete view";
        readonly tone: "border-rose-200 bg-rose-50 text-rose-800";
      },
      {
        readonly kind: "view_restore";
        readonly label: "Restore view";
        readonly tone: "border-emerald-200 bg-emerald-50 text-emerald-800";
      },
      {
        readonly kind: "base_add_field";
        readonly label: "Add field";
        readonly tone: "border-emerald-200 bg-emerald-50 text-emerald-800";
      },
      {
        readonly kind: "base_delete_field";
        readonly label: "Delete field";
        readonly tone: "border-red-200 bg-red-50 text-red-800";
      },
      {
        readonly kind: "base_update_field";
        readonly label: "Update field";
        readonly tone: "border-sky-200 bg-sky-50 text-sky-800";
      },
      {
        readonly kind: "base_convert_field";
        readonly label: "Convert field";
        readonly tone: "border-violet-200 bg-violet-50 text-violet-800";
      },
      {
        readonly kind: "base_reorder_fields";
        readonly label: "Reorder fields";
        readonly tone: "border-indigo-200 bg-indigo-50 text-indigo-800";
      },
      {
        readonly kind: "base_restore_field";
        readonly label: "Restore field";
        readonly tone: "border-teal-200 bg-teal-50 text-teal-800";
      },
      {
        readonly kind: "base_archive";
        readonly label: "Archive base";
        readonly tone: "border-orange-200 bg-orange-50 text-orange-800";
      },
      {
        readonly kind: "base_restore";
        readonly label: "Restore base";
        readonly tone: "border-teal-200 bg-teal-50 text-teal-800";
      },
      {
        readonly kind: "record_restore";
        readonly label: "Restore record";
        readonly tone: "border-teal-200 bg-teal-50 text-teal-800";
      },
    ];
  },
  {
    readonly type: string;
    readonly label: string;
    readonly icon: string;
    readonly capabilities: {
      readonly hasDetail: true;
      readonly creatable: true;
    };
    readonly operations: readonly [
      {
        readonly kind: `${string}_file_create`;
        readonly label: "Create file";
        readonly tone: "border-emerald-200 bg-emerald-50 text-emerald-800";
      },
      {
        readonly kind: `${string}_file_update`;
        readonly label: "Update file";
        readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
      },
      {
        readonly kind: `${string}_file_delete`;
        readonly label: "Delete file";
        readonly tone: "border-rose-200 bg-rose-50 text-rose-800";
      },
      {
        readonly kind: `${string}_metadata_update`;
        readonly label: `Update ${string}`;
        readonly tone: "border-violet-200 bg-violet-50 text-violet-800";
      },
    ];
  },
  {
    readonly type: string;
    readonly label: string;
    readonly icon: string;
    readonly capabilities: {
      readonly hasDetail: true;
      readonly creatable: true;
    };
    readonly operations: readonly [
      {
        readonly kind: `${string}_file_create`;
        readonly label: "Create file";
        readonly tone: "border-emerald-200 bg-emerald-50 text-emerald-800";
      },
      {
        readonly kind: `${string}_file_update`;
        readonly label: "Update file";
        readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
      },
      {
        readonly kind: `${string}_file_delete`;
        readonly label: "Delete file";
        readonly tone: "border-rose-200 bg-rose-50 text-rose-800";
      },
      {
        readonly kind: `${string}_metadata_update`;
        readonly label: `Update ${string}`;
        readonly tone: "border-violet-200 bg-violet-50 text-violet-800";
      },
    ];
  },
  {
    readonly type: string;
    readonly label: string;
    readonly icon: string;
    readonly capabilities: {
      readonly hasDetail: true;
      readonly creatable: true;
    };
    readonly operations: readonly [
      {
        readonly kind: `${string}_file_create`;
        readonly label: "Create file";
        readonly tone: "border-emerald-200 bg-emerald-50 text-emerald-800";
      },
      {
        readonly kind: `${string}_file_update`;
        readonly label: "Update file";
        readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
      },
      {
        readonly kind: `${string}_file_delete`;
        readonly label: "Delete file";
        readonly tone: "border-rose-200 bg-rose-50 text-rose-800";
      },
      {
        readonly kind: `${string}_metadata_update`;
        readonly label: `Update ${string}`;
        readonly tone: "border-violet-200 bg-violet-50 text-violet-800";
      },
    ];
  },
  {
    readonly type: "file";
    readonly label: "File";
    readonly icon: "file";
    readonly capabilities: {
      readonly hasDetail: true;
      readonly creatable: true;
    };
    readonly operations: readonly [];
  },
  {
    readonly type: "doc";
    readonly label: "Doc";
    readonly icon: "file-text";
    readonly capabilities: {
      readonly hasDetail: true;
      readonly creatable: true;
    };
    readonly operations: readonly [
      {
        readonly kind: "doc_update";
        readonly label: "Update doc";
        readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
      },
    ];
  },
  {
    readonly type: "form";
    readonly label: "Form";
    readonly icon: "form";
    readonly capabilities: {
      readonly hasDetail: true;
      readonly creatable: true;
    };
    readonly operations: readonly [];
  },
  {
    readonly type: "whiteboard";
    readonly label: "Whiteboard";
    readonly icon: "pen-tool";
    readonly capabilities: {
      readonly hasDetail: true;
      readonly creatable: true;
    };
    readonly operations: readonly [
      {
        readonly kind: "whiteboard_document_update";
        readonly label: "Update whiteboard";
        readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
      },
    ];
  },
  {
    readonly type: "workflow";
    readonly label: "Workflow";
    readonly icon: "workflow";
    readonly capabilities: {
      readonly hasDetail: true;
      readonly creatable: true;
    };
    readonly operations: readonly [
      {
        readonly kind: "workflow_document_update";
        readonly label: "Update workflow";
        readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
      },
    ];
  },
  {
    readonly type: "html";
    readonly label: "HTML";
    readonly icon: "code-xml";
    readonly capabilities: {
      readonly hasDetail: true;
      readonly creatable: true;
    };
    readonly operations: readonly [
      {
        readonly kind: "html_document_update";
        readonly label: "Update HTML";
        readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
      },
    ];
  },
];
type BuiltinDefinition = (typeof BUILTIN_NODE_TYPES)[number];
export type NodeType = BuiltinDefinition["type"];
export declare const NODE_TYPES: [NodeType, ...NodeType[]];
export type CreatableNodeType = Extract<
  BuiltinDefinition,
  {
    capabilities: {
      creatable: true;
    };
  }
>["type"];
export declare const CREATABLE_NODE_TYPES: [CreatableNodeType, ...CreatableNodeType[]];
type GenericOperationKind = (typeof GENERIC_NODE_OPERATIONS)[number]["kind"];
type RegisteredOperationKind = BuiltinDefinition["operations"][number]["kind"];
export type OperationKind = GenericOperationKind | RegisteredOperationKind;
export declare const OPERATION_KINDS: [OperationKind, ...OperationKind[]];
/** Generic kernel tree operations (act on any node, regardless of type). */
export declare const GENERIC_NODE_OPERATION_KINDS: [
  GenericOperationKind,
  ...GenericOperationKind[],
];
export declare const OPERATION_META: Record<OperationKind, OperationMeta>;
export declare const getOperationMeta: (kind: string) => OperationMeta | undefined;
export declare const listNodeTypes: () => NodeTypeDefinition[];
export declare const getNodeType: (type: string) => NodeTypeDefinition | undefined;
export declare const hasCapability: (type: string, capability: keyof NodeCapabilities) => boolean;
