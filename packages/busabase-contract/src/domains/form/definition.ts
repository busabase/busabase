import type { NodeTypeDefinition } from "../types";

/**
 * Form node: an agent-authored, sandboxed web page bound to a Base via an
 * explicit field-binding contract. A submission does NOT write a record
 * directly — it produces an approval-first record-create ChangeRequest on the
 * target Base (so the submitting act reuses the base's `record_create` op, not a
 * form-specific one). The form's own config (bindings/page/share) is owner-
 * managed and edited directly, so this node contributes no CR operations of its
 * own for now. See apps/busabase/content/spec/form-as-node.md.
 */
export const formNodeType = {
  type: "form",
  label: "Form",
  icon: "form",
  capabilities: { hasDetail: true, creatable: true },
  operations: [],
} as const satisfies NodeTypeDefinition;
