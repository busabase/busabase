/**
 * Storage-backed airapp (no extra DB tables). Owns the airapp_file_* /
 * airapp_metadata_* operations. An agent writes a small Node/Hono project into
 * the file tree via the normal ChangeRequest flow; a human opens the node and
 * runs it in-browser (see busabase-core's `domains/airapp/components/RunPanel`).
 */
export declare const airappNodeType: {
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
