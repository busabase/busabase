/** Container type: holds children AND has a detail screen (its contents listing).
 *  Owns no DB table — a folder is just a node row. */
export declare const folderNodeType: {
  readonly type: "folder";
  readonly label: "Folder";
  readonly icon: "folder";
  readonly capabilities: {
    readonly container: true;
    readonly creatable: true;
    readonly hasDetail: true;
  };
  readonly operations: readonly [];
};
