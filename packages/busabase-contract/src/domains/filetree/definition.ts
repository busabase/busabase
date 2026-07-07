import type { NodeTypeDefinition, OperationDefinition } from "../types";

export interface FileTreeKindDefinitionConfig {
  type: string;
  label: string;
  icon: string;
  routeBase: string;
  tag: string;
  entryFile: string;
}

export const fileTreeOperations = <TType extends string>(type: TType) =>
  [
    {
      kind: `${type}_file_create`,
      label: "Create file",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    {
      kind: `${type}_file_update`,
      label: "Update file",
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
    {
      kind: `${type}_file_delete`,
      label: "Delete file",
      tone: "border-rose-200 bg-rose-50 text-rose-800",
    },
    {
      kind: `${type}_metadata_update`,
      label: `Update ${type}`,
      tone: "border-violet-200 bg-violet-50 text-violet-800",
    },
  ] as const satisfies readonly OperationDefinition[];

export const makeFileTreeNodeType = <TConfig extends FileTreeKindDefinitionConfig>(
  config: TConfig,
) =>
  ({
    type: config.type,
    label: config.label,
    icon: config.icon,
    capabilities: { hasDetail: true, creatable: true },
    operations: fileTreeOperations(config.type),
  }) as const satisfies NodeTypeDefinition;
