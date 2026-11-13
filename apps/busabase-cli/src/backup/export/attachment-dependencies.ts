import type { Manifest } from "../format/manifest.js";
import { canonicalHash } from "./raw-blob-spool.js";
import type { SnapshotDependency, SnapshotRow } from "./sql-snapshot.js";

const ATTACHMENT_COLUMNS = [
  "id",
  "storageKey",
  "fileName",
  "mimeType",
  "sizeBytes",
  "contentHash",
  "context",
  "userId",
  "spaceId",
  "metadata",
  "createdAt",
  "updatedAt",
];
const MARKER_COLUMNS = [
  "version",
  "sourceAssetId",
  "sourceAttachmentId",
  "sourceSpaceId",
  "projection",
  "originalAttachmentOwnershipOmitted",
];
const plain = (value: unknown): value is SnapshotRow =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: SnapshotRow, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const iso = (value: unknown): string | undefined => {
  const text = value instanceof Date ? value.toISOString() : value;
  if (typeof text !== "string") return;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(text);
  if (!match || !Number.isFinite(Date.parse(text))) return;
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
};

/** The only foreign dependency representation accepted is the explicit public-file projection. */
export function materializeAttachmentDependency(
  dependency: SnapshotDependency,
  asset: SnapshotRow,
  spaceId: string,
  sourceHost: string,
): { row: SnapshotRow; receipt: NonNullable<Manifest["attachmentMaterializations"]>[number] } {
  function reject(): never {
    throw new Error(
      `Unsafe or stale attachment dependency for asset ${dependency.assetId}; no archive was published.`,
    );
  }
  const row = dependency.materializedAttachment;
  if (
    dependency.assetId !== asset.id ||
    dependency.attachmentId !== asset.attachmentId ||
    !plain(row) ||
    !exact(row, ATTACHMENT_COLUMNS)
  )
    reject();
  if (
    row.id !== dependency.attachmentId ||
    row.spaceId !== spaceId ||
    typeof asset.createdBy !== "string" ||
    row.userId !== asset.createdBy ||
    row.context !== "busabase-backup-dependency"
  )
    reject();
  if (
    typeof row.storageKey !== "string" ||
    !row.storageKey ||
    typeof row.fileName !== "string" ||
    typeof row.mimeType !== "string" ||
    !Number.isSafeInteger(row.sizeBytes) ||
    (row.sizeBytes as number) < 0
  )
    reject();
  if (!(row.contentHash === null || typeof row.contentHash === "string")) reject();
  canonicalHash(row.contentHash, `materialized attachment ${row.id}`);
  if (
    !iso(asset.createdAt) ||
    !iso(asset.updatedAt) ||
    iso(row.createdAt) !== iso(asset.createdAt) ||
    iso(row.updatedAt) !== iso(asset.updatedAt)
  )
    reject();
  const metadata = row.metadata;
  if (!plain(metadata) || !exact(metadata, ["busabaseBackupDependency"])) reject();
  const marker = metadata.busabaseBackupDependency;
  if (
    !plain(marker) ||
    !exact(marker, MARKER_COLUMNS) ||
    marker.version !== 1 ||
    marker.sourceAssetId !== asset.id ||
    marker.sourceAttachmentId !== asset.attachmentId ||
    marker.sourceSpaceId !== spaceId ||
    marker.projection !== "readable-asset-content" ||
    marker.originalAttachmentOwnershipOmitted !== true
  )
    reject();
  const url = new URL(dependency.downloadUrl, sourceHost);
  if (!new Set(["http:", "https:"]).has(url.protocol)) reject();
  return {
    row,
    receipt: {
      version: 1,
      assetId: dependency.assetId,
      attachmentId: dependency.attachmentId,
      sourceSpaceId: spaceId,
      storageKey: row.storageKey as string,
      projection: "readable-asset-content",
      originalAttachmentOwnershipOmitted: true,
      ownershipSource: "source-asset",
    },
  };
}
