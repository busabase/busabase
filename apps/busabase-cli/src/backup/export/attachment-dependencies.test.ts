import { describe, expect, it } from "vitest";
import { materializeAttachmentDependency } from "./attachment-dependencies.js";
import type { SnapshotDependency } from "./sql-snapshot.js";

const time = "2026-11-11T00:00:00.000Z";
const asset = {
  id: "ast_a",
  attachmentId: "att_shared",
  createdBy: "own-user",
  createdAt: time,
  updatedAt: time,
};
const dependency = (): SnapshotDependency => ({
  assetId: asset.id,
  attachmentId: asset.attachmentId,
  downloadUrl: "/files/attachments/shared.txt",
  materializedAttachment: {
    id: asset.attachmentId,
    spaceId: "local",
    storageKey: "attachments/shared.txt",
    fileName: "visible.txt",
    mimeType: "text/plain",
    sizeBytes: 3,
    contentHash: null,
    context: "busabase-backup-dependency",
    userId: asset.createdBy,
    createdAt: time,
    updatedAt: time,
    metadata: {
      busabaseBackupDependency: {
        version: 1,
        sourceAssetId: asset.id,
        sourceAttachmentId: asset.attachmentId,
        sourceSpaceId: "local",
        projection: "readable-asset-content",
        originalAttachmentOwnershipOmitted: true,
      },
    },
  },
});
describe("readable attachment dependency provenance", () => {
  it("records a user-owned projection receipt instead of claiming a raw foreign row", () => {
    const out = materializeAttachmentDependency(dependency(), asset, "local", "http://localhost");
    expect(out.row.userId).toBe("own-user");
    expect(out.receipt).toMatchObject({
      assetId: "ast_a",
      attachmentId: "att_shared",
      originalAttachmentOwnershipOmitted: true,
      ownershipSource: "source-asset",
    });
    expect(out.receipt).not.toHaveProperty("downloadUrl");
  });
  it.each(["userId", "createdAt", "spaceId", "context"])(
    "rejects foreign %s provenance",
    (column) => {
      const input = dependency();
      input.materializedAttachment[column] = "foreign";
      expect(() =>
        materializeAttachmentDependency(input, asset, "local", "http://localhost"),
      ).toThrow(/Unsafe or stale/);
    },
  );
  it("rejects arbitrary metadata/owner columns and stale Asset identity", () => {
    const input = dependency();
    input.materializedAttachment.metadata = { foreignSecret: "hidden" };
    expect(() =>
      materializeAttachmentDependency(input, asset, "local", "http://localhost"),
    ).toThrow();
    const extra = dependency();
    extra.materializedAttachment.foreignOwner = "hidden";
    expect(() =>
      materializeAttachmentDependency(extra, asset, "local", "http://localhost"),
    ).toThrow();
    const stale = dependency();
    stale.attachmentId = "different";
    expect(() =>
      materializeAttachmentDependency(stale, asset, "local", "http://localhost"),
    ).toThrow();
  });
});

it("accepts equivalent trailing-zero timestamp precision but preserves non-zero microseconds", () => {
  const own = {
    ...asset,
    createdAt: "2026-11-11T00:00:00.123456Z",
    updatedAt: "2026-11-11T00:00:00.123000Z",
  };
  const input = dependency();
  input.materializedAttachment.createdAt = own.createdAt;
  input.materializedAttachment.updatedAt = "2026-11-11T00:00:00.123Z";
  expect(
    materializeAttachmentDependency(input, own, "local", "http://localhost").row.createdAt,
  ).toBe(own.createdAt);
  input.materializedAttachment.createdAt = "2026-11-11T00:00:00.123Z";
  expect(() => materializeAttachmentDependency(input, own, "local", "http://localhost")).toThrow();
});
