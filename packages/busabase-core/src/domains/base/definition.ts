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
  ],
} as const satisfies NodeTypeDefinition;
