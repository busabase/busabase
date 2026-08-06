/**
 * Doc bodies reference embedded images by ASSET, not by storage location:
 * `![](/api/assets/{assetId}/raw)`. Asset ids are host-local — installing a
 * package onto a different host mints brand-new ones — so a body carried
 * verbatim across hosts points at ids that do not exist there.
 *
 * This module is the whole asset-reference story of the format, in one place:
 *
 *   • {@link extractDocAssetIds} — which assets a body needs (export reads this
 *     to know what bytes to carry; install reads it to know what to rewrite)
 *   • {@link collectDocAssetIds} — the same, across a whole tree, deduped
 *   • {@link docAssetBytesPath} — where those bytes live in the package
 *   • {@link rewriteDocAssetIds} — old id → new id once install has uploaded them
 *   • {@link reportUnresolvableDocAssets} — the honest warning for what is left
 *     over: an image the exporter could not read, or a hand-authored package
 *     whose `assets/` is incomplete. Rewriting cannot invent bytes, so those
 *     references are named out loud rather than installed silently broken.
 *
 * The URL pattern is duplicated from busabase-core's
 * `src/domains/assets/utils/asset-content-url.ts` on purpose — this package is
 * published standalone to npm and `busabase-core` is a `private: true` workspace
 * package it cannot take a dependency on. It is duplicated ONCE, here: extract
 * and rewrite share the single regex below, exactly as they do in busabase-core.
 * Keep the two files in sync; `asset-content-url.test.ts` and this file's tests
 * assert the same shapes, including the "a partial map leaves unknown references
 * byte-for-byte alone" rule.
 */

import { extname } from "node:path";
import { PACKAGE_ASSETS_DIRNAME } from "busabase-contract/domains/package/types";
import type { PackageDocAsset, PackageNode } from "./tree";
import { walkNodes } from "./tree";

const ASSET_CONTENT_URL_PATTERN = /\/api\/assets\/([A-Za-z0-9_-]+)\/raw/g;

/** The stable content URL for an asset — the form Doc bodies store. */
const buildAssetContentUrl = (assetId: string): string =>
  `/api/assets/${encodeURIComponent(assetId)}/raw`;

/** Every asset id a doc body references, in first-seen order, deduped. */
export const extractDocAssetIds = (body: string): string[] => {
  const ids = new Set<string>();
  for (const match of body.matchAll(ASSET_CONTENT_URL_PATTERN)) {
    const assetId = match[1];
    if (assetId) ids.add(assetId);
  }
  return [...ids];
};

/**
 * Every asset id referenced by every Doc in a tree, deduped and in first-seen
 * order. One image embedded in three Docs is carried once, so this is also the
 * export's download list.
 */
export const collectDocAssetIds = (nodes: readonly PackageNode[]): string[] => {
  const ids = new Set<string>();
  for (const node of walkNodes(nodes)) {
    if (node.type !== "doc") continue;
    for (const assetId of extractDocAssetIds(node.body)) ids.add(assetId);
  }
  return [...ids];
};

/**
 * Where a carried asset's bytes live: `assets/<assetId><ext>`.
 *
 * Named by asset id, not by file name: two Docs can embed two different images
 * both called `screenshot.png`, and the id is the only thing that is unique and
 * that the bodies actually reference. The original extension is kept so the file
 * is recognizable in a git diff and opens in an editor; the original name itself
 * lives in the sidecar and is restored on install.
 */
export const docAssetBytesPath = (asset: Pick<PackageDocAsset, "assetId" | "fileName">): string =>
  `${PACKAGE_ASSETS_DIRNAME}/${asset.assetId}${extname(asset.fileName).toLowerCase()}`;

/**
 * Re-point every asset reference in a body through `idMap` (old id → new id).
 * References with no mapping are left byte-for-byte alone — a partial map must
 * never corrupt the references it does not know about, and a body that still
 * shows a dead image is strictly better than one whose surviving images were
 * mangled. Mirrors busabase-core's `rewriteAssetContentIds`.
 */
export const rewriteDocAssetIds = (body: string, idMap: ReadonlyMap<string, string>): string => {
  if (idMap.size === 0) return body;
  return body.replace(ASSET_CONTENT_URL_PATTERN, (whole, assetId: string) => {
    const replacement = idMap.get(assetId);
    return replacement === undefined ? whole : buildAssetContentUrl(replacement);
  });
};

/**
 * The warning to record for a doc whose inline images could not be carried (or,
 * at install time, could not be re-uploaded), or `undefined` when there is
 * nothing to say. `carried` is the set of asset ids that ARE accounted for, so
 * the ordinary case — every image carried — produces no warning at all.
 *
 * Returned rather than pushed so the caller owns its warning list and this stays
 * pure. Used from both ends: `collect` names what it could not download, `apply`
 * names what it could not upload.
 */
export const reportUnresolvableDocAssets = (
  slug: string,
  body: string,
  carried: ReadonlySet<string> = new Set(),
): string | undefined => {
  const unresolved = extractDocAssetIds(body).filter((assetId) => !carried.has(assetId));
  if (unresolved.length === 0) return undefined;
  // Worded to be true from BOTH ends: the exporter is told what it failed to put
  // in, the installer is told what was not there to take out.
  return (
    `Doc "${slug}" embeds ${unresolved.length} image(s) that this package does not carry ` +
    `(${unresolved.join(", ")}). Everything else about the doc is intact, but those images ` +
    `will not render on another host. Re-upload them in the Doc editor, or check that the ` +
    `source host can still serve them.`
  );
};
