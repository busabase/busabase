/**
 * The kinds served by the file-tree machinery, registered in one place.
 *
 * Import this module for its side effect anywhere that resolves a file-tree
 * kind by name at runtime (`getFileTreeKind` / `resolveFileTreeKind`). It used
 * to live inline in `router.ts`, which was fine while the file-tree routes were
 * the only entry point; the unified `nodes.get` dispatcher
 * (`logic/node-detail.ts`) now resolves kinds too, and it must not depend on
 * whether some unrelated router module happened to be imported first.
 */

import { registerNodeRuntime } from "../../logic/node-runtime";
import { airappFileTreeConfig } from "../airapp/handlers";
import { driveFileTreeConfig } from "../drive/logic/config";
import { skillFileTreeConfig } from "../skill/handlers";
import { getFileTreeKind, getFileTreeNode, registerFileTreeKind } from "./handlers";

registerFileTreeKind(skillFileTreeConfig);
registerFileTreeKind(driveFileTreeConfig);
registerFileTreeKind(airappFileTreeConfig);

/**
 * The three file-tree types share ONE hydrator, so they register it here
 * together rather than each domain repeating it — the same reason their kind
 * configs are registered here. Relocated from `logic/node-detail.ts`'s
 * `NODE_DETAIL_BUILDERS`, which had to name all three explicitly.
 */
const FILE_TREE_NODE_TYPES = ["skill", "drive", "airapp"] as const;

for (const type of FILE_TREE_NODE_TYPES) {
  registerNodeRuntime(type, {
    hydrateDetail: async (node) => {
      const detail = await getFileTreeNode(getFileTreeKind(type), node.id);
      return {
        type,
        ...detail,
        // `skippedGitignorePaths` only ever carries anything on a CREATE
        // response; on a read it is empty. The contract's schema defaults it,
        // so normalize here too rather than letting a read and its schema
        // disagree.
        skippedGitignorePaths: detail.skippedGitignorePaths ?? [],
      };
    },
  });
}
