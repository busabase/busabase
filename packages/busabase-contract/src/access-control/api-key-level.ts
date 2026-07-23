/**
 * API key permission levels — a single ordered tier per key, the same mental
 * model this app already uses for human org roles (`owner`/`admin`/`member`/
 * `viewer`). Solves the "an agent's key can call `changeRequests.merge` just
 * as freely as `nodes.createChangeRequest`" gap: an over-eager agent must not
 * be able to self-merge its own proposal into production.
 *
 * Pure zod/TS, no db/react import — importable from both the backend
 * enforcement point (`apps/busabase-cloud/src/domains/openapi/router.ts`,
 * `workbenchProcedure`) and the frontend `kui/select` (api-keys settings UI).
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
 * Storage envelope written into the existing (already-migrated, currently
 * unused) `permissions` text column on Better Auth's `apikeys` table as
 * `JSON.stringify(...)`, and `JSON.parse`'d back on read — see
 * `apps/busabase-cloud/src/domains/api-keys/logic/api-keys-logic.ts` and
 * `logic/api-key-auth.ts`. `null` (the column's default) means "no
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
export const apiKeyPermissionsSchema = z
  .object({
    level: z.enum(["read", "changeRequest", "write", "manage"]),
    nodeScope: z.array(z.string()).optional(),
  })
  .nullable();

export type ApiKeyPermissions = z.infer<typeof apiKeyPermissionsSchema>;

/**
 * Explicit path → level table for every procedure whose required level is
 * NOT the safe-by-default outcome (`resolveRequiredLevel`: a GET route
 * defaults to `read`; every other route method — and a procedure with no
 * `.route()` at all, e.g. `live.subscribe` — defaults to `manage`,
 * fail-closed). Keyed by the procedure's dotted path *relative to
 * `busabaseRouter`* (e.g. `"bases.create"`, `"changeRequests.merge"`) — see
 * `resolveRequiredLevel` for why the real oRPC `path` seen at runtime carries
 * a leading `"workbench"` mount-key segment that must be stripped first.
 *
 * Enumerated against the real `packages/busabase-core/src/router.ts` +
 * every `packages/busabase-contract/src/domains/*​/contract.ts` route
 * definition (not guessed) — see the implementation report for the full
 * cross-check, including two known deviations from the original design
 * table:
 *   - `dump.exportTables` is a POST route in the real contract (the design
 *     doc's prose called it a GET) — already force-classified to `manage`
 *     below either way, so this doesn't change behavior, just the reasoning.
 *   - The top-level `grep` and `assets.grep` routes are POST (chosen for
 *     their request body, not because they mutate anything) and are NOT
 *     listed here, so they fail closed to `manage` via the default rule
 *     rather than being guessed into an unlisted `read` override — flagged
 *     as a follow-up in the report, not resolved by invention.
 */
export const PROCEDURE_LEVEL_OVERRIDES: Record<string, ApiKeyPermissionLevel> = {
  // ---- changeRequest: the full proposal-lifecycle family (never touches live
  // data), plus amending a still-pending proposal, plus uploading/writing an
  // asset for use inside a not-yet-merged proposal (deliberate inclusion). ----
  "nodes.createChangeRequest": "changeRequest",
  "operations.revise": "changeRequest",
  "bases.createChangeRequest": "changeRequest",
  "bases.createBulkChangeRequest": "changeRequest",
  "bases.createFieldChangeRequest": "changeRequest",
  "bases.createViewChangeRequest": "changeRequest",
  "bases.deleteFieldChangeRequest": "changeRequest",
  "bases.updateFieldChangeRequest": "changeRequest",
  "bases.convertFieldChangeRequest": "changeRequest",
  "bases.reorderFieldsChangeRequest": "changeRequest",
  "bases.archiveChangeRequest": "changeRequest",
  "bases.restoreChangeRequest": "changeRequest",
  "bases.restoreFieldChangeRequest": "changeRequest",
  "records.updateChangeRequest": "changeRequest",
  "records.deleteChangeRequest": "changeRequest",
  "records.restoreChangeRequest": "changeRequest",
  "views.updateChangeRequest": "changeRequest",
  "views.deleteChangeRequest": "changeRequest",
  "views.restoreChangeRequest": "changeRequest",
  "docs.createChangeRequest": "changeRequest",
  "skills.createChangeRequest": "changeRequest",
  "drives.createChangeRequest": "changeRequest",
  "airapps.createChangeRequest": "changeRequest",
  "assets.createUploadUrl": "changeRequest",
  "assets.confirm": "changeRequest",
  "assets.putText": "changeRequest",
  "assets.createTextUploadUrl": "changeRequest",

  // ---- write: applying/rejecting a proposal (including self-merge — the
  // reported gap), plus every direct-write mutation that bypasses the CR flow. ----
  "changeRequests.review": "write",
  "changeRequests.reviewMany": "write",
  "changeRequests.merge": "write",
  "changeRequests.mergeMany": "write",
  "changeRequests.close": "write",
  "bases.create": "write",
  "docs.create": "write",
  "docs.updateBody": "write",
  "drives.create": "write",
  "skills.create": "write",
  "airapps.create": "write",
  "files.create": "write",
  "nodes.move": "write",
  "nodes.updateMetadata": "write",
  "comments.create": "write",
  "auditEvents.create": "write",
  "assets.updateMetadata": "write",
  "assets.delete": "write",
  "assets.editContent": "write",

  // ---- manage: automation config, bulk export/import, hard delete. ----
  "webhooks.create": "manage",
  "webhooks.update": "manage",
  "webhooks.delete": "manage",
  "webhooks.testFire": "manage",
  "dump.exportTables": "manage",
  "dump.importBegin": "manage",
  "dump.importTables": "manage",
  "dump.importCommit": "manage",
  "dump.importAbort": "manage",
  "nodes.purge": "manage",
};

/**
 * `workbenchProcedure.router(busabaseRouter)` is later spread into the
 * `workbench` key of the served router
 * (`apps/busabase-cloud/src/domains/openapi/router.ts`), and oRPC resolves
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
 * Fail-closed classification: an explicit override always wins; otherwise a
 * `GET` route is read-only (`read`, always allowed); every other route
 * method — including `undefined` for a procedure with no `.route()` at all —
 * defaults to the highest tier (`manage`), so a forgotten-to-classify new
 * mutation requires the highest tier until someone consciously downgrades it,
 * never silently granting broad access.
 */
export function resolveRequiredLevel(
  path: readonly string[],
  routeMethod: string | undefined,
): ApiKeyPermissionLevel {
  const key = normalizePath(path).join(".");
  const override = PROCEDURE_LEVEL_OVERRIDES[key];
  if (override) return override;
  return routeMethod === "GET" ? "read" : "manage";
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
 */
export function permissionLevelForSpaceRole(
  role: string | null | undefined,
): ApiKeyPermissionLevel {
  if (role === "owner" || role === "admin") return "manage";
  if (role === "member") return "changeRequest";
  return "read";
}
