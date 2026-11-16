import "server-only";

import type { FileTreeFileVO } from "busabase-contract/types";
import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { attachments, busabaseAssets, busabaseAssetUsages, type NodePO } from "../../../db/schema";
import type { AssetUsageOwnerType } from "../../assets/schema/assets";
import { normalizeContentHash } from "../utils/content-hash";

// Maps a file-tree kind's `type` to its Asset usage owner type. Every file-tree
// kind (drive/skill/airapp/…) is its own `AssetUsageOwnerType` so asset-usage
// rows stay correctly tagged — a prior version of this function collapsed
// anything that wasn't "skill" into "drive", silently mis-tagging every other
// file-tree kind's files as Drive files in the asset-usage index.
export const usageOwnerType = (configOrType: { type: string } | string): AssetUsageOwnerType => {
  const type = typeof configOrType === "string" ? configOrType : configOrType.type;
  if (type === "skill" || type === "drive" || type === "airapp") {
    return type;
  }
  throw new Error(`Unsupported file-tree kind for asset usage: ${type}`);
};

export interface FilePage {
  limit?: number;
  /** Keyset cursor: return files whose path sorts strictly after this one. */
  after?: string;
  /** Legacy window. Ignored when `after` is given; every skipped row still pays the joins. */
  offset?: number;
}

/** The rows that are files: an empty `path` is a whole-node usage (Doc body, Base field), not a file. */
export const assetUsageFileConditions = (node: NodePO) => [
  eq(busabaseAssetUsages.spaceId, getContextSpaceId()),
  eq(busabaseAssetUsages.ownerType, usageOwnerType(node.type)),
  eq(busabaseAssetUsages.nodeId, node.id),
  ne(busabaseAssetUsages.path, ""),
];

/**
 * Rows whose path sits under `prefix` (`"docs/"`, or `""` for the root).
 *
 * `left(path, n) = prefix` rather than a `>= / <` range: a range is only right
 * under the "C" collation, and production Postgres may sort `/` differently.
 * Equality on a prefix is collation-free. Drizzle has no `left()`.
 *
 * `n` comes from the DATABASE (`char_length`), not from `prefix.length`: JS
 * counts UTF-16 code units and Postgres counts characters, so a folder named
 * `📁` would slice one character too many (`📁/a.md` → `📁/a`) and list nothing.
 */
export const underFolder = (prefix: string) =>
  prefix === ""
    ? undefined
    : sql`left(${busabaseAssetUsages.path}, char_length(${prefix})) = ${prefix}`;

/** The part of the path after `prefix`. Postgres `substr` is 1-based, and — as above — `char_length`, not `.length`. */
export const pathBelow = (prefix: string) =>
  sql`substr(${busabaseAssetUsages.path}, char_length(${prefix}) + 1)`;

interface FolderFilter {
  /** Only files directly in this folder (`"docs/"`, or `""` for the root). */
  directlyIn?: string;
}

export const listAssetUsageFiles = async (
  node: NodePO,
  page: FilePage = {},
  filter: FolderFilter = {},
): Promise<FileTreeFileVO[]> => {
  const db = await getDb();
  const prefix = filter.directlyIn;
  const ordered = db
    .select({
      path: busabaseAssetUsages.path,
      metadata: busabaseAssetUsages.metadata,
      updatedAt: busabaseAssetUsages.updatedAt,
      assetId: busabaseAssets.id,
      assetName: busabaseAssets.name,
      contentKind: busabaseAssets.contentKind,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      contentHash: attachments.contentHash,
    })
    .from(busabaseAssetUsages)
    .innerJoin(busabaseAssets, eq(busabaseAssetUsages.assetId, busabaseAssets.id))
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(
      and(
        ...assetUsageFileConditions(node),
        page.after === undefined ? undefined : gt(busabaseAssetUsages.path, page.after),
        prefix === undefined ? undefined : underFolder(prefix),
        prefix === undefined ? undefined : sql`strpos(${pathBelow(prefix)}, '/') = 0`,
      ),
    )
    // `(node_id, path)` is indexed, so this order needs no sort, and a path
    // cursor resumes in O(page) instead of re-joining every skipped row.
    .orderBy(asc(busabaseAssetUsages.path));
  const offset = page.after === undefined ? (page.offset ?? 0) : 0;
  const rows = await (page.limit === undefined
    ? ordered.offset(offset)
    : ordered.limit(page.limit).offset(offset));

  return rows.map((row) => ({
    path: row.path,
    name: row.path.split("/").at(-1) ?? row.path,
    size: row.sizeBytes,
    updatedAt: row.updatedAt.toISOString(),
    mimeType: row.mimeType,
    assetId: row.assetId,
    contentHash: normalizeContentHash(row.contentHash),
    displayName:
      typeof row.metadata.displayName === "string"
        ? row.metadata.displayName
        : row.assetName || row.fileName,
  }));
};
