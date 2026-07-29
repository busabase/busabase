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

import { airappFileTreeConfig } from "../airapp/handlers";
import { driveFileTreeConfig } from "../drive/logic/config";
import { skillFileTreeConfig } from "../skill/handlers";
import { registerFileTreeKind } from "./handlers";

registerFileTreeKind(skillFileTreeConfig);
registerFileTreeKind(driveFileTreeConfig);
registerFileTreeKind(airappFileTreeConfig);
