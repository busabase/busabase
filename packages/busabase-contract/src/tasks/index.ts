/**
 * The task registry — the single source both `busabase-cli` and the MCP servers
 * read to build their user-facing surfaces. See `./types.ts` for why the layer
 * exists at all.
 *
 * Adding a task here gives it a CLI command and an MCP tool at once. If it
 * supersedes endpoint-level tools, list them in `supersededMcpTools` so the MCP
 * adapter drops them from the catalog instead of publishing both spellings of
 * the same job.
 */

import { baseFieldChangeTask } from "./base-field";
import {
  changeRequestMergeTask,
  changeRequestQueryTask,
  changeRequestReviewTask,
} from "./change-request";
import {
  nodeFilesChangeRequestTask,
  nodeGetTask,
  nodeListFilesTask,
  nodeListTask,
  nodeReadFileTask,
} from "./file-tree";
import { listArchivedTask } from "./list-archived";
import { nodePermissionTask, nodeShareTask } from "./node-access";
import { nodeArchiveTask } from "./node-archive";
import { nodeCreateTask } from "./node-create";
import { recordChangeTask } from "./record-change";
import { recordFindByFieldTask } from "./record-find-by-field";
import { recordQueryTask } from "./record-query";
import type { TaskDefinition } from "./types";
import { viewChangeTask } from "./view-change";

export { baseFieldChangeTask } from "./base-field";
export {
  changeRequestMergeTask,
  changeRequestQueryTask,
  changeRequestReviewTask,
} from "./change-request";
export {
  nodeFilesChangeRequestTask,
  nodeGetTask,
  nodeListFilesTask,
  nodeListTask,
  nodeReadFileTask,
} from "./file-tree";
export { listArchivedTask } from "./list-archived";
export { nodePermissionTask, nodeShareTask } from "./node-access";
export { nodeArchiveTask } from "./node-archive";
export { nodeCreateTask } from "./node-create";
export { recordChangeTask } from "./record-change";
export { recordFindByFieldTask } from "./record-find-by-field";
export { recordQueryTask } from "./record-query";
export type { BusabaseTaskClient, TaskAnnotations, TaskDefinition, TaskParam } from "./types";
export { taskInputSchema, taskParamFlag } from "./types";
export { viewChangeTask } from "./view-change";

// Each task is individually typed at its definition site. The registry is the
// erased view the adapters iterate, and `execute`'s input is contravariant, so
// no concrete object type can stand in for every task here.
export const BUSABASE_TASKS: readonly TaskDefinition<any>[] = [
  nodeCreateTask,
  nodeArchiveTask,
  nodeListTask,
  nodeGetTask,
  nodeListFilesTask,
  nodeReadFileTask,
  nodeFilesChangeRequestTask,
  recordFindByFieldTask,
  recordQueryTask,
  changeRequestQueryTask,
  changeRequestReviewTask,
  changeRequestMergeTask,
  baseFieldChangeTask,
  recordChangeTask,
  viewChangeTask,
  nodePermissionTask,
  nodeShareTask,
  listArchivedTask,
];

/**
 * Endpoint-level MCP tools fully covered by a task above, keyed by the tool name
 * the OpenAPI generator produces. The MCP adapter excludes these so a catalog
 * carries one way to do each job rather than two.
 *
 * Kept as tool names (not contract paths) because that is what the MCP layer
 * filters on, and it is the name an agent would actually have seen.
 *
 * NOT listed on purpose:
 *   - `nodes_create_change_request` — `node_create` covers only a single `create`
 *     operation. The endpoint also does `rename`, and composes several operations
 *     into one change request (`ref`/`parentNodeRef` builds a whole subtree
 *     atomically). Excluding it would be a capability regression, not a cleanup.
 *   - `forms_create` — configures an existing node, so it is a second step after
 *     `node_create --type form`, not a duplicate of it.
 *   - `nodes_purge` — permanent delete is a genuinely different operation from
 *     `node_archive`, and `node_archive`'s guidance now tells an agent when each
 *     one applies.
 */
export const TASK_SUPERSEDED_MCP_TOOLS: readonly string[] = [
  // -> node_create
  "skills_create",
  "drives_create",
  "airapps_create",
  "docs_create",
  "bases_create",
  "files_create",
  // -> record_find_by_field
  "records_search",
  // -> node_list_files_trees / node_get_file_tree / node_files_list /
  //    node_file_read / node_files_change_request. Fifteen endpoints that
  //    differ only in a path prefix; see `file-tree.ts`.
  "skills_list",
  "drives_list",
  "airapps_list",
  "skills_get",
  "drives_get",
  "airapps_get",
  "skills_list_files",
  "drives_list_files",
  "airapps_list_files",
  "skills_read_file",
  "drives_read_file",
  "airapps_read_file",
  "skills_create_change_request",
  "drives_create_change_request",
  "airapps_create_change_request",
  // -> record_query (always paginated; `records_list` truncates silently)
  "records_list",
  "records_list_paged",
  "records_count",
  // -> change_request_query
  "change_requests_list",
  "change_requests_list_paged",
  "change_requests_counts",
  // -> change_request_review / change_request_merge (ids array covers both
  //    the single and the batch endpoint)
  "change_requests_review",
  "change_requests_review_many",
  "change_requests_merge",
  "change_requests_merge_many",
  // -> base_field_change_request (one `operation` instead of six tools whose
  //    names differ only by the verb in the middle)
  "bases_create_field_change_request",
  "bases_update_field_change_request",
  "bases_delete_field_change_request",
  "bases_convert_field_change_request",
  "bases_reorder_fields_change_request",
  "bases_restore_field_change_request",
  // -> record_change_request
  "records_update_change_request",
  "records_delete_change_request",
  "records_restore_change_request",
  // -> view_change_request (create lives on the Base, the rest on the view —
  //    an artefact of which id the route needs, not of what the caller is doing)
  "bases_create_view_change_request",
  "views_update_change_request",
  "views_delete_change_request",
  "views_restore_change_request",
  // -> node_permission
  "nodes_principals_list",
  "nodes_principals_add",
  "nodes_principals_remove",
  // -> node_share
  "nodes_share_get",
  "nodes_share_set",
  "nodes_share_disable",
  // -> list_archived
  "nodes_list_archived",
  "bases_list_archived",
  "bases_list_deleted_fields",
  "bases_list_archived_views",
  "bases_list_archived_records",
  "bases_list_archived_records_paged",
];

/**
 * Tools withheld from MCP because they do not belong in an agent's hands —
 * NOT because a task supersedes them. Kept separate from
 * `TASK_SUPERSEDED_MCP_TOOLS` so the reason stays legible: these have no
 * replacement, they are simply out of scope for an agent.
 *
 * The CLI keeps every one of them; `dump` is what `busabase-cli backup` and
 * `restore` are built on.
 */
export const AGENT_EXCLUDED_MCP_TOOLS: readonly string[] = [
  // A stateful export/import session protocol (begin -> tables -> commit/abort)
  // driven by the CLI's backup/restore. An agent has no reason to move raw table
  // rows around, and a half-driven session leaves an import open.
  "dump_export_tables",
  "dump_export_asset_text",
  "dump_import_begin",
  "dump_import_tables",
  "dump_import_commit",
  "dump_import_abort",
  // Internal tree predicate used by the UI to validate a drag target.
  "nodes_is_descendant",
  // Installing a package writes a whole subtree of nodes into the workspace from
  // a third-party GitHub repo. That is a human's decision about what to trust,
  // not a step an agent should take on its own. `busabase-cli install` keeps it.
  "install_plan_from_github",
  "install_from_github",
  // The Vault holds API keys and other credentials, and `vault.get` returns each
  // item's DECRYPTED `value` — `rowToVO` in busabase-core decodes it and the
  // `access.reveal` policy is passed through untouched rather than enforced. So
  // publishing these hands an agent every secret in the workspace, and `clear`
  // wipes them. Busabase Cloud already withholds the whole namespace from its
  // public contract; the self-hosted server was serving them.
  //
  // Credentials reach an agent the way they always have: the server injects the
  // Vault's runtime env into the process it runs. The agent never needs to read
  // them itself.
  "vault_get",
  "vault_update",
  "vault_clear",
];
