/**
 * The one place that guarantees every builtin node type's server-side behaviour
 * is registered (`./node-runtime`).
 *
 * Import this module — for its side effects — from anything that dispatches on
 * node type. Do NOT hand-roll the import list at each dispatch site.
 *
 * That rule is the whole reason this file exists. The merge kernel used to carry
 * its own copy of these imports, and its comment records what happened when a
 * consumer assumed someone else had loaded them: `node_create` for a
 * Skill/Drive/AirApp fell back to the generic materializer and produced a node
 * with **zero files**. The registry lookup returned `undefined` and the caller
 * treated that as "this type needs nothing special", so the failure was silent —
 * no throw, no log, just a broken node.
 *
 * One barrel means adding a builtin node type is one line here, and a consumer
 * cannot be half-right about which types it loaded.
 *
 * Safe to import in any order, and safe to import more than once: each module
 * registers on first evaluation, and `registerNodeRuntime` merges rather than
 * replaces.
 *
 * (Build-time plugin packages are not listed here — they register themselves
 * when the app imports the plugin. This barrel covers first-party types only.)
 */

import "../domains/airapp/handlers";
import "../domains/base/logic/merge/base";
import "../domains/doc/handlers";
import "../domains/form/logic/form-ops";
import "../domains/drive/handlers";
import "../domains/file-node/handlers";
import "../domains/folder/handlers";
import "../domains/rich-node/handlers";
import "../domains/skill/handlers";
// Registers the skill/drive/airapp file-tree kinds, which the three file-tree
// hydrators resolve through `getFileTreeKind`.
import "../domains/filetree/kinds";
