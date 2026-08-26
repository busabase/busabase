/**
 * API key permission levels — a single ordered tier per key, the same mental
 * model this app already uses for human org roles (`owner`/`admin`/`member`/
 * `viewer`). Solves the "an agent's key can call `changeRequests.merge` just
 * as freely as `nodes.createChangeRequest`" gap: an over-eager agent must not
 * be able to self-merge its own proposal into production.
 *
 * Pure zod/TS, no db/react import — importable from both the backend
 * enforcement point (the host's `workbenchProcedure` middleware) and the
 * frontend `kui/select` (api-keys settings UI).
 */

import { z } from "zod";

export type ApiKeyPermissionLevel = "read" | "changeRequest" | "write" | "manage";

/** Ascending order — each level includes everything below it. */
export const API_KEY_LEVELS: readonly ApiKeyPermissionLevel[] = [
  "read",
  "changeRequest",
  "write",
  "manage",
];

export const API_KEY_LEVEL_ORDER: Record<ApiKeyPermissionLevel, number> = {
  read: 0,
  changeRequest: 1,
  write: 2,
  manage: 3,
};

/**
 * Internal relay metadata set by Busabase Cloud after authenticating a public
 * API caller. User-supplied copies are stripped before Cloud injects its own
 * value, so OSS can safely apply the credential ceiling without receiving the
 * Cloud API key itself.
 */
export const BUSABASE_RELAY_PERMISSION_LEVEL_HEADER = "x-busabase-relay-permission-level";

export const parseBusabaseRelayPermissionLevel = (
  value: string | null | undefined,
): ApiKeyPermissionLevel | null =>
  API_KEY_LEVELS.includes(value as ApiKeyPermissionLevel) ? (value as ApiKeyPermissionLevel) : null;

/**
 * Storage envelope written into the existing (already-migrated, currently
 * unused) `permissions` text column on Better Auth's `apikeys` table as
 * `JSON.stringify(...)`, and `JSON.parse`'d back on read by the host's API-key
 * issue/authenticate logic. `null` (the column's default) means "no
 * restriction" — full access, identical to every key issued before this
 * feature existed.
 *
 * `nodeScope` is reserved, NOT enforced in this phase: the anticipated future
 * extension is restricting a key to a node subtree (view/changeRequest/write/
 * manage on node X and its descendants only), built on the existing
 * `nodes.isDescendant` procedure. Storing the envelope shape now (instead of
 * a bare level string) means that lands as an additive read of an
 * already-present optional field — no column change, no reinterpretation of
 * rows written by this phase's UI (`nodeScope` absent = unrestricted, today's
 * behavior either way).
 */
/** Stored/read shape. `nodeScope` is accepted only for legacy forward-compatible reads. */
export const apiKeyPermissionsSchema = z
  .object({
    level: z.enum(["read", "changeRequest", "write", "manage"]),
    nodeScope: z.array(z.string()).optional(),
  })
  .nullable();

export type ApiKeyPermissions = z.infer<typeof apiKeyPermissionsSchema>;

/** Public creation shape: nodeScope is intentionally rejected until it is enforced. */
export const createApiKeyPermissionsSchema = z
  .object({
    level: z.enum(["read", "changeRequest", "write", "manage"]),
  })
  .strict()
  .nullable();

export interface ProcedurePermissionPolicy {
  level: ApiKeyPermissionLevel;
  /** Workspace policies also require the human's workspace role to meet `level`. */
  scope: "workspace" | "node";
}

/**
 * Explicit path → level+scope table for every current procedure. Nothing is
 * inferred from HTTP method: POST grep/preview routes can be reads, while GET
 * Webhook/Vault configuration routes are manage. Any unknown path defaults to
 * workspace manage, and the parity test prevents contract additions from
 * remaining unknown in reviewed code. Keyed by the dotted path *relative to
 * `busabaseRouter`* (e.g. `"bases.create"`, `"changeRequests.merge"`) — see
 * `resolveRequiredLevel` for why the real oRPC `path` seen at runtime carries
 * a leading `"workbench"` mount-key segment that must be stripped first.
 *
 * Enumerated against the real `packages/busabase-core/src/router.ts` +
 * every `packages/busabase-contract/src/domains/*​/contract.ts` route
 * definition (not guessed) — see the implementation report for the full
 * cross-check, including known method/semantics deviations:
 *   - `dump.exportTables` is a POST route in the real contract (the design
 *     doc's prose called it a GET) — already force-classified to `manage`
 *     below either way, so this doesn't change behavior, just the reasoning.
 *   - The top-level `grep` route is POST because it takes a request body, but
 *     is explicitly classified as a node-scoped read.
 */
const node = (level: ApiKeyPermissionLevel): ProcedurePermissionPolicy => ({
  level,
  scope: "node",
});
const workspace = (level: ApiKeyPermissionLevel): ProcedurePermissionPolicy => ({
  level,
  scope: "workspace",
});

/**
 * Exhaustive policy for the current Busabase contract. A contract-parity test
 * fails when a procedure is added without an explicit decision here.
 */
export const PROCEDURE_PERMISSION_POLICY: Record<string, ProcedurePermissionPolicy> = {
  "auth.verify": workspace("read"),
  search: node("read"),
  grep: node("read"),
  "nodes.list": node("read"),
  // The unified typed-detail read that replaced `docs.get` / `files.get` /
  // `folders.get` / `fileTrees.get`. Still a plain node-scoped read: the
  // per-node ACL inside busabase-core decides which nodes resolve at all.
  "nodes.get": node("read"),
  "nodes.searchByName": node("read"),
  "nodes.isDescendant": node("read"),
  // ---- changeRequest: the full proposal-lifecycle family (never touches live
  // data), plus amending a still-pending proposal, plus uploading/writing an
  // asset for use inside a not-yet-merged proposal (deliberate inclusion). ----
  "nodes.createChangeRequest": node("changeRequest"),
  "operations.revise": node("changeRequest"),
  "bases.createChangeRequest": node("changeRequest"),
  "bases.createBulkChangeRequest": node("changeRequest"),
  "bases.createBulkUpdateChangeRequest": node("changeRequest"),
  "bases.fieldChangeRequest": node("changeRequest"),
  "bases.lifecycleChangeRequest": node("changeRequest"),
  "records.changeRequest": node("changeRequest"),
  "views.changeRequest": node("changeRequest"),
  // Unified content write for doc/whiteboard/workflow/html — replaces
  // `docs.createChangeRequest` (and `docs.updateBody`, below the write tier)
  // with one endpoint whose `autoMerge` is server-decided from the actor's
  // write permission (spec D3). Floor is `changeRequest`, same as every other
  // proposal-creating procedure in this family.
  "nodes.updateContent": node("changeRequest"),
  "fileTrees.createChangeRequest": node("changeRequest"),
  "assets.createUploadUrl": workspace("changeRequest"),
  "assets.confirm": workspace("changeRequest"),
  // Same "upload for a not-yet-merged proposal" reasoning as the asset pair
  // above, but node-scoped rather than workspace-wide: a node icon belongs to
  // one node (see `attachments-logic.ts`'s `nodeIconOwnerId`), and the actual
  // node mutation only lands via `nodes.createChangeRequest`'s `rename` op.
  "nodes.icon.createUploadUrl": node("changeRequest"),
  "nodes.icon.confirm": node("changeRequest"),
  "assets.putText": node("write"),
  "assets.createTextUploadUrl": node("write"),

  // ---- write: applying/rejecting a proposal (including self-merge — the
  // reported gap), plus every direct-write mutation that bypasses the CR flow. ----
  "changeRequests.review": node("write"),
  "changeRequests.merge": node("write"),
  "changeRequests.close": node("write"),
  "bases.create": node("write"),
  "bases.createField": node("write"),
  "docs.create": node("write"),
  "fileTrees.create": node("write"),
  "files.create": node("write"),
  "nodes.move": node("write"),
  "nodes.updateMetadata": node("write"),
  "nodes.toggleFavorite": node("write"),
  "comments.create": node("write"),
  // Manage, not write: audit entries are records of what the SYSTEM did, and
  // the only external callers are administrative/agent tooling. At `write` the
  // member baseline would let any member inject enum-valid lifecycle events
  // (e.g. a `change_request.merged` that never happened) into the activity
  // feed. Actor identity is still context-resolved either way — this gates
  // pollution, impersonation was never possible.
  "auditEvents.create": workspace("manage"),
  "assets.updateMetadata": node("write"),
  "assets.delete": node("write"),
  "assets.editContent": node("write"),

  // ---- manage: automation config, bulk export/import, hard delete. ----
  "webhooks.list": workspace("manage"),
  "webhooks.get": workspace("manage"),
  "webhooks.create": workspace("manage"),
  "webhooks.update": workspace("manage"),
  "webhooks.delete": workspace("manage"),
  "webhooks.deliveries": workspace("manage"),
  "webhooks.testFire": workspace("manage"),
  "vault.get": workspace("manage"),
  "vault.update": workspace("manage"),
  "vault.clear": workspace("manage"),
  "dump.exportTables": workspace("manage"),
  "dump.exportAssetText": workspace("manage"),
  "dump.importBegin": workspace("manage"),
  "dump.importTables": workspace("manage"),
  "dump.importCommit": workspace("manage"),
  "dump.importAbort": workspace("manage"),
  "nodes.purge": node("manage"),
  "nodes.updateVisibility": node("manage"),
  "nodes.principals.list": node("manage"),
  "nodes.principals.add": node("manage"),
  "nodes.principals.remove": node("manage"),
  "nodes.share.get": node("manage"),
  "nodes.share.set": node("manage"),
  "nodes.share.disable": node("manage"),

  "nodes.listFavorites": node("read"),
  "auditEvents.list": node("read"),
  "activity.listPaged": node("read"),
  "activity.listForNode": node("read"),
  "activity.listForRecord": node("read"),
  "comments.list": node("read"),
  "agent.listTasks": node("read"),
  // The SSE payload is space-wide and not yet per-event node filtered.
  "live.subscribe": workspace("manage"),

  "bases.list": node("read"),
  "bases.get": node("read"),
  "bases.listDeletedFields": node("read"),
  "bases.listViews": node("read"),
  "bases.previewFieldConversion": node("read"),

  "fileTrees.listFiles": node("read"),
  "fileTrees.readFile": node("read"),
  "airapps.runLocal": node("write"),
  "airapps.stopLocal": node("write"),
  "nodes.readLines": node("read"),

  "forms.list": node("read"),
  "forms.getByNode": node("read"),
  "forms.create": node("manage"),
  "forms.update": node("manage"),
  "forms.submit": node("changeRequest"),

  "assets.list": node("read"),
  "assets.get": node("read"),
  "assets.download": node("read"),
  "assets.readTextLines": node("read"),

  "install.planFromGithub": workspace("read"),
  "install.fromGithub": workspace("manage"),
  // The Template Center's catalog. Sits at the floor rather than beside
  // `install.fromGithub` because it reads a public repository's index and
  // returns nothing about this workspace — a key that may read anything at all
  // is not told less by being shown what exists to install. Installing is the
  // privileged act, and it is classified as such one line above.
  "templates.list": workspace("read"),

  // The operating manual. Static documents about how Busabase works, carrying
  // nothing about this workspace and no way to change it — the floor, for the
  // same reason `templates.list` sits there. Anything stricter would be
  // self-defeating: a `read` key that cannot read the rules it is expected to
  // follow is exactly the situation these routes exist to end.
  "guides.list": workspace("read"),
  "guides.read": workspace("read"),

  // ---- agents: spawning/driving an external ACP agent (Claude Code, Codex,
  // …) is arbitrary local code execution, not scoped to any one node — every
  // procedure in this family sits at the ceiling, same tier as vault/webhooks.
  "agents.catalog": workspace("manage"),
  "agents.connections.list": workspace("manage"),
  "agents.disconnect": workspace("manage"),
  "agents.sessions.list": workspace("manage"),
  "agents.sessions.create": workspace("manage"),
  "agents.sessions.prompt": workspace("manage"),
  "agents.sessions.cancel": workspace("manage"),
  "agents.sessions.close": workspace("manage"),
  "agents.sessions.subscribe": workspace("manage"),
  "agents.sessions.respondToPermission": workspace("manage"),

  "changeRequests.list": node("read"),
  // Same data as `list`, addressed by page number instead of cursor — so it must
  // sit at the same level. A read-level gap here would let a numbered page
  // return change requests the cursor listing would have refused.
  "changeRequests.listPage": node("read"),
  // RPC-only dashboard composition of listPage + counts. It exposes no data
  // beyond those two node-scoped reads, so it keeps the same permission floor.
  "changeRequests.inboxSnapshot": node("read"),
  "changeRequests.counts": node("read"),
  "changeRequests.get": node("read"),

  "records.list": node("read"),
  "records.listPage": node("read"),
  "records.count": node("read"),
  "records.get": node("read"),
  "records.search": node("read"),
  "records.listChangeRequests": node("read"),
  "records.listLinks": node("read"),
};

/** Backward-compatible level-only export used by older tests/callers. */
export const PROCEDURE_LEVEL_OVERRIDES: Record<string, ApiKeyPermissionLevel> = Object.fromEntries(
  Object.entries(PROCEDURE_PERMISSION_POLICY).map(([path, policy]) => [path, policy.level]),
);

/**
 * `workbenchProcedure.router(busabaseRouter)` is later spread into the
 * `workbench` key of the router the host actually serves, and oRPC resolves
 * `path` against the FULL served router tree, not the sub-router the
 * middleware was attached to — confirmed empirically against both
 * `OpenAPIHandler` and `RPCHandler` (the two handlers actually used in
 * production): a call to `workbench.bases.create` delivers
 * `path: ["workbench", "bases", "create"]` to the middleware, not
 * `["bases", "create"]` as originally assumed. Strip that one known mount-key
 * segment; leave any other shape untouched (e.g. a future direct mount, or a
 * unit test that passes a bare `busabaseRouter`-relative path).
 */
const normalizePath = (path: readonly string[]): string[] =>
  path[0] === "workbench" ? path.slice(1) : [...path];

/**
 * Backward-compatible level-only resolver. HTTP method is deliberately ignored:
 * known paths use the explicit semantic policy and unknown paths fail closed to
 * manage regardless of whether they happen to be GET, POST, or RPC-only.
 */
export function resolveRequiredLevel(
  path: readonly string[],
  _routeMethod: string | undefined,
): ApiKeyPermissionLevel {
  const key = normalizePath(path).join(".");
  const override = PROCEDURE_LEVEL_OVERRIDES[key];
  if (override) return override;
  return "manage";
}

export function resolveProcedurePermissionPolicy(
  path: readonly string[],
): ProcedurePermissionPolicy {
  const key = normalizePath(path).join(".");
  return PROCEDURE_PERMISSION_POLICY[key] ?? workspace("manage");
}

/**
 * `storedLevel == null` → legacy/unset key (every key that existed before
 * this feature shipped, and every key created without picking a level) →
 * full access, zero behavior change. Otherwise ordinal comparison: a level
 * includes everything at or below it.
 */
export function hasApiKeyLevel(
  storedLevel: ApiKeyPermissionLevel | null | undefined,
  required: ApiKeyPermissionLevel,
): boolean {
  if (storedLevel == null) return true;
  return API_KEY_LEVEL_ORDER[storedLevel] >= API_KEY_LEVEL_ORDER[required];
}

/**
 * Caps an actor's space-role-derived permission level at the API key's own
 * stored restriction — the key's level is a coarse per-route gate at the
 * transport boundary (`resolveRequiredLevel`/`hasApiKeyLevel` above); on its
 * own it never limits what busabase-core's node-ACL logic sees for the rest
 * of the request, so a `changeRequest`-only key issued to an agent held by a
 * workspace owner would otherwise resolve node-level checks (e.g. the
 * permission-aware `autoMerge` default) against the OWNER's `manage` level
 * instead of the key's own restriction — exactly the "an over-eager agent's
 * key can act as freely as the human who issued it" gap this file exists to
 * close. `storedLevel == null` (legacy/unset key) applies no cap, matching
 * `hasApiKeyLevel`'s null handling.
 */
export function capApiKeyLevel(
  spaceRoleLevel: ApiKeyPermissionLevel,
  storedLevel: ApiKeyPermissionLevel | null | undefined,
): ApiKeyPermissionLevel {
  if (storedLevel == null) return spaceRoleLevel;
  return API_KEY_LEVEL_ORDER[storedLevel] < API_KEY_LEVEL_ORDER[spaceRoleLevel]
    ? storedLevel
    : spaceRoleLevel;
}

/**
 * Maps the cloud host's human workspace roles onto the same ordered permission
 * ladder used by API keys and node ACLs. Unknown/missing roles fail closed to
 * read-only; single-user and remote-tunnel hosts should pass `manage`
 * explicitly because they do not have a cloud membership row.
 *
 * `member` is `write`, not `changeRequest`. The narrower baseline made a member
 * a proposer who could never approve anything — not even the change request
 * they had just opened themselves, and not even a folder at the workspace root
 * that nobody else had any claim on. The UI offered the approve/request-changes
 * panel anyway and the click came back `Requires write workspace access or
 * write access on every target node`, so the role read as broken rather than
 * as deliberate. A member is a colleague inside the workspace: they write, and
 * they review each other. `manage` (webhooks, vault, node visibility,
 * principals, public shares, purge) stays with owner/admin, which is where the
 * decisions that affect the whole space belong.
 *
 * This baseline only ever applies to nodes a member can already SEE by default
 * — `getEffectiveNodeLevel` starts from `null`, not from the baseline, for a
 * private subtree or (in Restricted mode) an unmarked one. Delegated access to
 * a closed folder is still exactly what its explicit grants say, so raising the
 * baseline does not reach into anything an admin has deliberately closed off.
 */
export function permissionLevelForSpaceRole(
  role: string | null | undefined,
): ApiKeyPermissionLevel {
  if (role === "owner" || role === "admin") return "manage";
  if (role === "member") return "write";
  return "read";
}
