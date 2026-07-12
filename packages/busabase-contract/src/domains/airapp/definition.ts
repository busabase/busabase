import { makeFileTreeNodeType } from "../filetree/definition";

/**
 * Storage-backed airapp (no extra DB tables). Owns the airapp_file_* /
 * airapp_metadata_* operations. An agent writes a small Node/Hono project into
 * the file tree via the normal ChangeRequest flow; a human opens the node and
 * runs it in-browser (see busabase-core's `domains/airapp/components/RunPanel`).
 */
export const airappNodeType = makeFileTreeNodeType({
  type: "airapp",
  label: "AirApp",
  icon: "app-window",
  routeBase: "airapps",
  tag: "AirApps",
  entryFile: "package.json",
});
