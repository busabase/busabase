import type { NodeTypeDefinition } from "../types";

/** Storage-backed skill (no extra DB tables). Owns the skill_file_* / skill_metadata_* operations. */
export const skillNodeType = {
  type: "skill",
  label: "Skill",
  icon: "sparkles",
  capabilities: { hasDetail: true, creatable: true },
  operations: [
    {
      kind: "skill_file_create",
      label: "Create file",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    {
      kind: "skill_file_update",
      label: "Update file",
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
    {
      kind: "skill_file_delete",
      label: "Delete file",
      tone: "border-rose-200 bg-rose-50 text-rose-800",
    },
    {
      kind: "skill_metadata_update",
      label: "Update skill",
      tone: "border-violet-200 bg-violet-50 text-violet-800",
    },
  ],
} as const satisfies NodeTypeDefinition;
