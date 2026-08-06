/**
 * The stable, storage-independent URL an Asset's raw bytes are reachable at:
 * `/api/assets/{assetId}/raw`.
 *
 * **Why this exists.** A Doc body is user content that outlives any single
 * storage configuration. When the Doc editor embedded the *resolved* storage
 * URL (`storage.getPublicUrl(storageKey)`) the markdown pinned itself to
 * whatever backend and route happened to be configured at write time — a body
 * authored in dev over the S3 adapter carries `/api/dev/attachment/…`, which
 * 404s in a production build; a body authored on local disk carries
 * `/api/storage/…`, which is meaningless once the space moves to S3/R2. The
 * asset id, by contrast, is stable for the life of the row, so the body
 * references the ASSET and the server resolves the location at read time.
 *
 * **Why a plain URL and not an `asset:` scheme.** In Busabase the Doc editor is
 * also the Doc viewer (Milkdown/Crepe round-trips the markdown it renders), so
 * anything the renderer resolved would be serialized straight back into the
 * saved body on the next save — a custom scheme would decay into resolved
 * storage URLs within one edit. A plain root-relative URL renders, serializes,
 * and re-parses identically, and every existing consumer of a Doc body (the
 * public embed HTML, mobile, CLI backup, package export, MCP/OpenAPI, grep,
 * demo) keeps working with no changes because it is just a URL.
 *
 * Pure and isomorphic on purpose: the browser editor builds these, the server's
 * where-used scanner parses them, and neither side may drag the other's runtime
 * in. No `~/db`, no react, no node-only APIs.
 */

/** Mount point of the app-level raw-content route (see `apps/busabase/src/app/api/assets`). */
export const ASSET_CONTENT_ROUTE_PREFIX = "/api/assets";

/** Trailing segment that distinguishes raw bytes from the JSON `/assets/{id}/content` API. */
export const ASSET_CONTENT_ROUTE_SUFFIX = "raw";

/** `ast…` ids are `${prefix}${base36}` (see `logic/kernel.ts` `id()`), so word chars only. */
const ASSET_ID_IN_URL = "[A-Za-z0-9_-]+";

/**
 * Matches the route anywhere in a text body, absolute or root-relative, so a
 * body that was rendered through an absolute origin (`https://host/api/assets/…`)
 * is recognized too. Not anchored, not global — `matchAll` supplies the `g`.
 */
const ASSET_CONTENT_URL_PATTERN = new RegExp(
  `${ASSET_CONTENT_ROUTE_PREFIX}/(${ASSET_ID_IN_URL})/${ASSET_CONTENT_ROUTE_SUFFIX}`,
  "g",
);

/** The stable content URL for an asset — what the Doc editor writes into markdown. */
export const buildAssetContentUrl = (assetId: string): string =>
  `${ASSET_CONTENT_ROUTE_PREFIX}/${encodeURIComponent(assetId)}/${ASSET_CONTENT_ROUTE_SUFFIX}`;

/** Every asset id referenced by a text body, in first-seen order, deduped. */
export const extractAssetContentIds = (body: string): string[] => {
  const ids = new Set<string>();
  for (const match of body.matchAll(ASSET_CONTENT_URL_PATTERN)) {
    const assetId = match[1];
    if (assetId) ids.add(assetId);
  }
  return [...ids];
};

/**
 * Re-point every asset reference in a body through `idMap` (old id → new id).
 * References with no mapping are left byte-for-byte alone — a partial map must
 * never corrupt the references it doesn't know about. Used when a package is
 * installed onto a different host, where the same bytes get brand-new asset ids.
 */
export const rewriteAssetContentIds = (
  body: string,
  idMap: ReadonlyMap<string, string>,
): string => {
  if (idMap.size === 0) return body;
  return body.replace(ASSET_CONTENT_URL_PATTERN, (whole, assetId: string) => {
    const replacement = idMap.get(assetId);
    return replacement === undefined ? whole : buildAssetContentUrl(replacement);
  });
};
