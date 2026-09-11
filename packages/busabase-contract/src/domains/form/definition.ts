import type { NodeTypeDefinition } from "../types";

/**
 * Form node: an agent-authored, sandboxed web page bound to a Base via an
 * explicit field-binding contract. A submission does NOT write a record
 * directly — it produces a record-create ChangeRequest on the target Base (so
 * the submitting act reuses the base's `record_create` op, not a form-specific
 * one), which then merges immediately or waits for review according to the
 * submitter's permission on that Base. The form's own config (bindings/page/share) is owner-
 * managed and edited directly, so this node contributes no CR operations of its
 * own for now.
 */
export const formNodeType = {
  type: "form",
  label: "Form",
  icon: "form",
  /**
   * `hidden` until a Form can be created from a create surface at all.
   *
   * `busabase_forms.target_base_id` is NOT NULL and `form` registers no
   * `node_create` materializer, so a Form built through the generic New-item
   * flow (which only collects name/slug/description) is a node row with no form
   * config behind it — it opens to a dead end, every time, for everyone. The
   * type stays fully `creatable` so `forms.create` (which does take a target
   * Base) and the REST/MCP surface are untouched; it just no longer offers an
   * entry point that cannot succeed. Drop this once the New-item flow asks for
   * the target Base and a materializer writes the config row.
   */
  capabilities: { hasDetail: true, creatable: true, publicAccess: "submit", hidden: true },
  operations: [],
} as const satisfies NodeTypeDefinition;
