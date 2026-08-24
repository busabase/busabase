export interface FileTreeKindDefinitionConfig {
  type: string;
  label: string;
  icon: string;
  routeBase: string;
  tag: string;
  entryFile: string;
}
export declare const fileTreeOperations: <TType extends string>(
  type: TType,
) => readonly [
  {
    readonly kind: `${TType}_file_create`;
    readonly label: "Create file";
    readonly tone: "border-emerald-200 bg-emerald-50 text-emerald-800";
  },
  {
    readonly kind: `${TType}_file_update`;
    readonly label: "Update file";
    readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
  },
  {
    readonly kind: `${TType}_file_delete`;
    readonly label: "Delete file";
    readonly tone: "border-rose-200 bg-rose-50 text-rose-800";
  },
  {
    readonly kind: `${TType}_metadata_update`;
    readonly label: `Update ${TType}`;
    readonly tone: "border-violet-200 bg-violet-50 text-violet-800";
  },
];
export declare const makeFileTreeNodeType: <TConfig extends FileTreeKindDefinitionConfig>(
  config: TConfig,
) => {
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
};
