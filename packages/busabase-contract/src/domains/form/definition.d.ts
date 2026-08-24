/**
 * Form node: an agent-authored, sandboxed web page bound to a Base via an
 * explicit field-binding contract. A submission does NOT write a record
 * directly — it produces an approval-first record-create ChangeRequest on the
 * target Base (so the submitting act reuses the base's `record_create` op, not a
 * form-specific one). The form's own config (bindings/page/share) is owner-
 * managed and edited directly, so this node contributes no CR operations of its
 * own for now.
 */
export declare const formNodeType: {
  readonly type: "form";
  readonly label: "Form";
  readonly icon: "form";
  readonly capabilities: {
    readonly hasDetail: true;
    readonly creatable: true;
  };
  readonly operations: readonly [];
};
