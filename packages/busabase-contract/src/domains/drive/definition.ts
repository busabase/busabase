import { makeFileTreeNodeType } from "../filetree/definition";

/** Storage-backed pure file drive. Owns the drive_file_* / drive_metadata_* operations. */
export const driveNodeType = makeFileTreeNodeType({
  type: "drive",
  label: "Drive",
  icon: "hard-drive",
  routeBase: "drives",
  tag: "Drives",
  entryFile: "README.md",
});
