import type { NodeTypeDefinition } from "../types";

/** Flagship type: structured records + views. Owns the record_* / view_* operations. */
export const baseNodeType = {
  type: "base",
  label: "Base",
  icon: "table",
  capabilities: { hasDetail: true, creatable: true },
  operations: [
    {
      kind: "record_create",
      label: "Create",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    { kind: "record_update", label: "Update", tone: "border-sky-200 bg-sky-50 text-sky-800" },
    { kind: "record_delete", label: "Delete", tone: "border-red-200 bg-red-50 text-red-800" },
    {
      kind: "record_variant",
      label: "Variant",
      tone: "border-violet-200 bg-violet-50 text-violet-800",
    },
    {
      kind: "view_create",
      label: "Create view",
      tone: "border-indigo-200 bg-indigo-50 text-indigo-800",
    },
    { kind: "view_update", label: "Update view", tone: "border-blue-200 bg-blue-50 text-blue-800" },
    { kind: "view_delete", label: "Delete view", tone: "border-rose-200 bg-rose-50 text-rose-800" },
    {
      kind: "view_restore",
      label: "Restore view",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    {
      kind: "base_add_field",
      label: "Add field",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    {
      kind: "base_delete_field",
      label: "Delete field",
      tone: "border-red-200 bg-red-50 text-red-800",
    },
    {
      kind: "base_update_field",
      label: "Update field",
      tone: "border-sky-200 bg-sky-50 text-sky-800",
    },
    {
      kind: "base_convert_field",
      label: "Convert field",
      tone: "border-violet-200 bg-violet-50 text-violet-800",
    },
    {
      kind: "base_reorder_fields",
      label: "Reorder fields",
      tone: "border-indigo-200 bg-indigo-50 text-indigo-800",
    },
    {
      kind: "base_restore_field",
      label: "Restore field",
      tone: "border-teal-200 bg-teal-50 text-teal-800",
    },
    {
      kind: "base_archive",
      label: "Archive base",
      tone: "border-orange-200 bg-orange-50 text-orange-800",
    },
    {
      kind: "base_restore",
      label: "Restore base",
      tone: "border-teal-200 bg-teal-50 text-teal-800",
    },
    {
      kind: "record_restore",
      label: "Restore record",
      tone: "border-teal-200 bg-teal-50 text-teal-800",
    },
  ],
} as const satisfies NodeTypeDefinition;
