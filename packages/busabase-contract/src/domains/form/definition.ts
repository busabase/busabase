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
   * No longer `hidden`. The two conditions that hid it are both met:
   *
   * 1. The New-item flow ASKS FOR THE TARGET BASE — `create-node-modal.tsx`
   *    renders a "Writes into" Base picker (plus the field checklist) whenever
   *    `form` is the selected type, and keeps its submit disabled until one is
   *    chosen, the same way it already does for `file` and its asset.
   * 2. A MATERIALIZER WRITES THE CONFIG ROW — `materializeFormNode`
   *    (busabase-core `domains/form/logic/form-ops.ts`) inserts the
   *    `busabase_forms` row inside the merge transaction, from the
   *    `node_create` operation's `metadata.targetBaseId` / `metadata.formBindings`.
   *    Both create paths run it, so a Form merged after review is configured
   *    exactly like one created immediately.
   *
   * A Form that still arrives unconfigured (an API caller that sent only the
   * generic node fields) is no longer a dead end either: the detail view's
   * "not set up yet" state now carries a "Connect this form to a Base" action.
   *
   * `hidden` is read by THREE create surfaces — web's `create-node-modal.tsx`,
   * `node-agent-prompts.ts`, and React Native's
   * `apps/busabase-mobile/.../CreateNodeModal.tsx`. Mobile has no Base picker,
   * so it names `form` in its own `UNSUPPORTED_TYPES` set (alongside `file`,
   * which is excluded there for the same "can't collect the required input"
   * reason) rather than re-creating the dead end on another platform.
   */
  capabilities: { hasDetail: true, creatable: true, publicAccess: "submit" },
  operations: [],
} as const satisfies NodeTypeDefinition;
