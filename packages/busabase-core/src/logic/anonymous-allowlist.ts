/**
 * Default-deny procedure allowlist for ANONYMOUS visitors (public node links).
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
 */

import { ORPCError } from "@orpc/server";

/** A procedure path (`["records", "listPaged"]`) as a stable dotted key. */
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
  // Single-node detail reads. Each asserts node visibility, which for an
  // anonymous visitor resolves through `getPublicScopeOf`.
  "folders.get",
  "files.get",
  "docs.get",
  "bases.get",
  // A base's views and rows are reachable only via a base the visitor could
  // already `bases.get`; the base-visibility EXISTS clause carries the same
  // anonymous branch.
  "bases.listViews",
  "records.list",
  "records.listPaged",
  "records.get",
  // Public form rendering. The `form` domain does not exist in the codebase
  // yet (P1 shipped the `submit` capability, not the form surface); listed now
  // so the read half lands correctly the moment it does.
  "form.getByNode",
]);

/**
 * Procedures an anonymous visitor may call ONLY when the target node's public
 * scope is exactly `"submit"`. A `"read"` share must never reach these — that
 * is the entire difference between the two capabilities.
 */
const ANONYMOUS_SUBMIT_ALLOWLIST: ReadonlySet<string> = new Set([
  // See the note on `form.getByNode`: not yet implemented, gated correctly in
  // advance so it cannot land as an unguarded mutation.
  "form.submit",
]);

export type AnonymousAccessKind = "read" | "submit";

/**
 * What an anonymous visitor is allowed to do with this procedure, or `null`
 * when the procedure is not part of the public surface at all.
 *
 * Default-deny: an unknown / newly added procedure returns `null` and is
 * rejected. Opening something up must be a deliberate edit to this file.
 */
export const anonymousAccessKindFor = (path: readonly string[]): AnonymousAccessKind | null => {
  // Match on the TAIL of the path, not the whole path: this router is mounted
  // at different depths by different hosts. The open-source single-user host
  // mounts it at the root (`nodes.list`), while busabase-cloud composes it
  // under a `core` key (`core.nodes.list`). Comparing the full path silently
  // matched nothing under the cloud mount, which fail-closed into "every
  // anonymous request denied" — a dead public page rather than a leak, but
  // dead all the same. Only procedures of THIS router reach this middleware
  // (it is attached via `enhanceRouter` on the busabase router alone), so a
  // suffix match cannot be spoofed by some unrelated sibling router.
  const matches = (key: string): boolean => {
    const segments = key.split(".");
    return path.length >= segments.length && toProcedureKey(path.slice(-segments.length)) === key;
  };
  for (const key of ANONYMOUS_READ_ALLOWLIST) {
    if (matches(key)) return "read";
  }
  for (const key of ANONYMOUS_SUBMIT_ALLOWLIST) {
    if (matches(key)) return "submit";
  }
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
export const denyAnonymousProcedure = (path: readonly string[]): never => {
  throw new ORPCError("FORBIDDEN", {
    message: `Not available to anonymous visitors: ${toProcedureKey(path)}`,
  });
};

/** Test/introspection helper: the frozen public surface, for assertions. */
export const anonymousAllowlistSnapshot = (): {
  read: string[];
  submit: string[];
} => ({
  read: [...ANONYMOUS_READ_ALLOWLIST].sort(),
  submit: [...ANONYMOUS_SUBMIT_ALLOWLIST].sort(),
});
