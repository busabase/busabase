/**
 * Storage-backed Doc (no extra DB tables). A deliberately minimal node type added
 * purely by registration — the proof that a new full-stack type is one
 * `domains/<type>/` folder + registration, with no kernel-logic or migration edits.
 */
export declare const docNodeType: {
  readonly type: "doc";
  readonly label: "Doc";
  readonly icon: "file-text";
  readonly capabilities: {
    readonly hasDetail: true;
    readonly creatable: true;
  };
  readonly operations: readonly [
    {
      readonly kind: "doc_update";
      readonly label: "Update doc";
      readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
    },
  ];
};
