/** Storage-backed pure file drive. Owns the drive_file_* / drive_metadata_* operations. */
export declare const driveNodeType: {
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
