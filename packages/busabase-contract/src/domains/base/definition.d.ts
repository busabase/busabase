/** Flagship type: structured records + views. Owns the record_* / view_* operations. */
export declare const baseNodeType: {
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
};
