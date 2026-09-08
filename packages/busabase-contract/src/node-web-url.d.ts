/**
 * The canonical web URL a *human* opens for a node — the thing you paste into
 * chat, an email, or a "copy link" button.
 *
 * This lives in the contract package on purpose. The formula used to exist in
 * exactly one place: a React component (`node-share-button.tsx`), inside a
 * `useMemo` that reads `window.location.origin`. That made it unreachable to
 * every headless caller — the SDK, the CLI, and the server itself — so anyone
 * who needed a link had to re-derive it and hope they matched. Both
 * `busabase-core` (workspace dep) and `busabase-sdk` (bundled in by tsup's
 * `noExternal`) can import from here, so there is one definition again.
 *
 * Note this is the *authenticated* dashboard URL. It is the right link for a
 * reader who has a session, and the durable one (it never expires). It is NOT a
 * no-login link: a node is only anonymously reachable at this URL once someone
 * has enabled public sharing on it, and a Cloud embed link is a different URL
 * shape entirely (`/embed/{id}?token=…`, minted per-node and short-lived).
 */
/** Where the web app is served from — the *browser* origin, not the API root. */
export interface NodeWebUrlInput {
  /**
   * Origin the dashboard is served from, e.g. `https://busabase.com` or
   * `http://localhost:15419`. A trailing slash and a trailing `/api/v1` are both
   * tolerated, because callers routinely have only an API base URL to hand and
   * the two happen to be same-origin on Cloud and on a local OSS server.
   */
  webOrigin: string;
  /**
   * Space id segment. Pass `null` for a workspace-subdomain host, where the
   * space is already implied by the hostname and the route drops the segment.
   */
  spaceId: string | null;
  /** Node type segment: `base`, `doc`, `folder`, `file`, `drive`, `skill`, `airapp`, … */
  nodeType: string;
  /** Node slug (or id, for types addressed by id). */
  nodeSlug: string;
  /**
   * Extra segments below the node, already in route order — e.g. a record id
   * under a Base (`/base/<slug>/<recordId>`). Empty/blank entries are dropped.
   */
  extraSegments?: readonly string[];
}
/**
 * Build the canonical dashboard URL for a node.
 *
 * Every caller-supplied segment is percent-encoded: a slug is user-controlled
 * text, and an un-encoded `/` or `?` in one would silently retarget the link.
 *
 * @throws {TypeError} when `webOrigin` is not a parseable absolute URL, so a
 * malformed config fails loudly at the call site instead of producing a link
 * that looks fine and 404s.
 */
export declare function nodeWebUrl({
  webOrigin,
  spaceId,
  nodeType,
  nodeSlug,
  extraSegments,
}: NodeWebUrlInput): string;
