/** A first-class workspace file node. The node row points at a Busabase Asset,
 *  while the actual bytes stay in Attachment storage. */
export declare const fileNodeType: {
  readonly type: "file";
  readonly label: "File";
  readonly icon: "file";
  readonly capabilities: {
    readonly hasDetail: true;
    readonly creatable: true;
  };
  readonly operations: readonly [];
};
