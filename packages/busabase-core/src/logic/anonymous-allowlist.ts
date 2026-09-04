/**
 * Default-deny procedure allowlists for the two LINK-authorized visitor kinds:
 * guests arriving through a node's public share, and holders of an Embed Link.
 *
 * Why this exists at all: busabase-core's node ACL is per-node, but a large part
 * of the RPC surface is space-scoped only — `dump.*`, `vault.*`, `webhooks.*`,
 * `assets.*`, `changeRequests.*`, `auditEvents.*`, `comments.*`, `activity.*`,
 * `agent.*`, `auth.verify` consult NO node ACL whatsoever. Reaching any one of
 * them as an anonymous visitor is a full-space data leak, not a scoped one. So
 * the anonymous surface cannot be "whatever isn't obviously dangerous": it has
 * to be an explicit, short, positive list, and everything else must fail closed.
 *
 * Why it lives here and not in the HTTP route: a URL-path check in the Next.js
 * route handler is trivially bypassed via the oRPC batch endpoint
 * (`/api/rpc/__batch__`), which arrives as ONE request path but fans out into
 * many procedure calls. This list is therefore consulted from per-procedure
 * oRPC middleware, so every call — batched or not — passes through it.
 *
 * SCOPE — this list governs oRPC PROCEDURES ONLY. A host may also expose a
 * non-RPC anonymous surface as a plain route handler, which never reaches this
 * middleware and so can never be gated from here. One exists today, and an
 * audit of "what can a logged-out visitor reach" has to read it too:
 *
 *   `GET /api/assets/{assetId}/raw` — an asset's bytes, in
 *   `apps/busabase/src/app/api/assets/…` (and its counterpart on Busabase
 *   Cloud). It is not listed here (an entry
 *   would be inert, and the nearest procedure — `assets.download` — is a wider
 *   surface than the route). It is safe for the reason this list exists: it
 *   performs exactly one read, through `resolveAssetContent` →
 *   `assertAssetPermission(id, "read")`, which is usage-backed and therefore
 *   node-ACL'd — an anonymous visitor reaches an image only as far as the Doc
 *   embedding it is publicly shared. Any FUTURE non-RPC anonymous route must
 *   clear the same bar and be recorded here.
 */

import { ORPCError } from "@orpc/server";
import { isPubliclyReadableNodeType, listNodeTypes } from "busabase-contract/domains";

/** A procedure path (`["records", "list"]`) as a stable dotted key. */
export const toProcedureKey = (path: readonly string[]): string => path.join(".");

/**
 * Reads a public page genuinely needs. Each one is per-node ACL-filtered:
 * `getEffectiveNodeLevel` returns null for an anonymous visitor unless the node
 * carries a live public scope, so these return "not found"/empty rather than
 * space-wide data.
 *
 * NOTE: nothing here may be a mutation, and nothing here may be a
 * space-scoped-only listing.
 */
const ANONYMOUS_READ_ALLOWLIST: ReadonlySet<string> = new Set([
  // The node tree itself — already filtered by `buildNodeVisibilityCondition`,
  // whose anonymous branch matches only nodes with a non-null public scope.
  "nodes.list",
  // The unified single-node detail read (it replaced `folders.get`,
  // `files.get`, and `docs.get`). It asserts node visibility, which for an
  // anonymous visitor resolves through the public-scope branch of
  // `buildNodeVisibilityCondition`.
  //
  // Reachability alone is NOT the whole gate here: merging four procedures into
  // one collapsed a distinction this list used to make by procedure name —
  // `fileTrees.get` was deliberately absent, so a public link could never be
  // used to read a Skill/Drive/AirApp's source. `ANONYMOUS_READABLE_NODE_TYPES`
  // below carries that boundary, and `logic/node-detail.ts` enforces it on the
  // RESOLVED node type before any hydration happens.
  "nodes.get",
  // Lightweight route guard. Active rows still pass through the public-share
  // ACL; archived rows deliberately collapse to `unavailable`.
  "nodes.resolveRouteState",
  "bases.get",
  // A base's views and rows are reachable only via a base the visitor could
  // already `bases.get`; the base-visibility EXISTS clause carries the same
  // anonymous branch.
  "bases.listViews",
  "records.list",
  "records.listPage",
  "records.get",
  // Public form rendering. The form logic still enforces the Form's own share
  // settings; this entry only makes the node-scoped procedure reachable.
  "forms.getByNode",
]);

/**
 * Reads an EMBED visitor may make (see `runWithEmbedContext`).
 *
 * Separate from the guest list because the two capabilities differ in both
 * directions. An embed resolves nodes through the link CREATOR's own grants
 * rather than a public share, so it does not need — and must not silently
 * inherit — the guest's share-scoped surface; conversely the reason a
 * default-deny list is needed at all is identical: `comments.*`,
 * `changeRequests.list`, `dump.*`, `vault.*`, `auditEvents.*`, `agent.*` and
 * the rest of the space-scoped-only surface consult NO node ACL, so reaching
 * any of them with a link would be a whole-Space read, not a scoped one.
 *
 * What is in: exactly what the embedded read-only Dashboard renders — the node
 * detail behind the link, and the Base/record slices its Change Request and
 * record previews hydrate from.
 *
 * What is deliberately out, and stays out:
 *   - `comments.*` — space-scoped, no node ACL. The embedded review UI hides
 *     the threads (`change-request-review.tsx`); this is the server half of
 *     that decision, so hiding is not the only thing standing between a link
 *     holder and every comment in the Space.
 *   - every mutation — `credentialPermissionCeiling: "read"` already caps
 *     authority, and nothing here should depend on that being the only cap.
 */
const EMBED_READ_ALLOWLIST: ReadonlySet<string> = new Set([
  "nodes.get",
  "nodes.list",
  "bases.get",
  "bases.listViews",
  "records.list",
  "records.listPage",
  "records.get",
  "changeRequests.get",
  "fileTrees.get",
  "fileTrees.readFile",
]);

/** True when an Embed Link holder may call this procedure. */
export const isEmbedProcedureAllowed = (path: readonly string[]): boolean =>
  matchesAnyKey(path, EMBED_READ_ALLOWLIST);

/**
 * Procedures an anonymous visitor may call ONLY when the target node's public
 * scope is exactly `"submit"`. A `"read"` share must never reach these — that
 * is the entire difference between the two capabilities.
 */
const ANONYMOUS_SUBMIT_ALLOWLIST: ReadonlySet<string> = new Set(["forms.submit"]);

/**
 * Whether an anonymous (public-link) visitor may read a node through `nodes.get`.
 *
 * The node registry is the single source of truth for this decision. New and
 * plugin-provided types still fail closed because `publicAccess` is opt-in;
 * setting it is the deliberate review point for public behavior. Only `detail`
 * and `submit` enter this hydration gate; runtime and source types stay out.
 */
/** Whether an anonymous visitor may read this node type's detail at all. */
export const isAnonymousReadableNodeType = (type: string): boolean =>
  isPubliclyReadableNodeType(type);

/**
 * Refuse a node type that is off the anonymous surface. Same FORBIDDEN code and
 * wording shape as `denyPublicProcedure` (see its note on why not 401), and
 * deliberately says nothing about whether the node exists.
 */
export const denyAnonymousNodeType = (type: string): never => {
  throw new ORPCError("FORBIDDEN", {
    message: `Not available to anonymous visitors: nodes of type "${type}"`,
  });
};

export type AnonymousAccessKind = "read" | "submit";

/**
 * What an anonymous visitor is allowed to do with this procedure, or `null`
 * when the procedure is not part of the public surface at all.
 *
 * Default-deny: an unknown / newly added procedure returns `null` and is
 * rejected. Opening something up must be a deliberate edit to this file.
 */
/**
 * Match on the TAIL of the path, not the whole path: this router is mounted at
 * different depths by different hosts. The open-source single-user host mounts
 * it at the root (`nodes.list`), while busabase-cloud composes it under a
 * `core` key (`core.nodes.list`). Comparing the full path silently matched
 * nothing under the cloud mount, which fail-closed into "every anonymous
 * request denied" — a dead public page rather than a leak, but dead all the
 * same. Only procedures of THIS router reach this middleware (it is attached
 * via `enhanceRouter` on the busabase router alone), so a suffix match cannot
 * be spoofed by some unrelated sibling router.
 */
const matchesAnyKey = (path: readonly string[], keys: ReadonlySet<string>): boolean => {
  for (const key of keys) {
    const segments = key.split(".");
    if (path.length >= segments.length && toProcedureKey(path.slice(-segments.length)) === key) {
      return true;
    }
  }
  return false;
};

export const anonymousAccessKindFor = (path: readonly string[]): AnonymousAccessKind | null => {
  if (matchesAnyKey(path, ANONYMOUS_READ_ALLOWLIST)) return "read";
  if (matchesAnyKey(path, ANONYMOUS_SUBMIT_ALLOWLIST)) return "submit";
  return null;
};

/** True when this procedure is reachable at all by an anonymous visitor. */
export const isAnonymousProcedureAllowed = (path: readonly string[]): boolean =>
  anonymousAccessKindFor(path) !== null;

/**
 * Throw the uniform rejection for a procedure outside the public surface.
 *
 * FORBIDDEN (not UNAUTHORIZED) on purpose: the visitor is not "missing a
 * login they could supply on this call" — this transport has no way to become
 * authenticated mid-request, and the client turns 401s into a sign-in bounce
 * that would loop on a legitimately public page.
 */
export const denyPublicProcedure = (path: readonly string[]): never => {
  throw new ORPCError("FORBIDDEN", {
    message: `Not available to anonymous visitors: ${toProcedureKey(path)}`,
  });
};

/** Test/introspection helper: the frozen public surface, for assertions. */
export const anonymousAllowlistSnapshot = (): {
  read: string[];
  submit: string[];
  nodeTypes: string[];
  embed: string[];
} => ({
  read: [...ANONYMOUS_READ_ALLOWLIST].sort(),
  submit: [...ANONYMOUS_SUBMIT_ALLOWLIST].sort(),
  nodeTypes: listNodeTypes()
    .filter((definition) => isPubliclyReadableNodeType(definition.type))
    .map((definition) => definition.type)
    .sort(),
  embed: [...EMBED_READ_ALLOWLIST].sort(),
});
