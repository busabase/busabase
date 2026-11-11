import { oc } from "@orpc/contract";
import {
  ExportAssetTextInputSchema,
  ExportAssetTextVOSchema,
  ExportAttachmentInputSchema,
  ExportAttachmentVOSchema,
  ExportDocBodiesInputSchema,
  ExportDocBodiesVOSchema,
  ExportTablesInputSchema,
  ExportTablesVOSchema,
  ImportAbortVOSchema,
  ImportBeginInputSchema,
  ImportBeginVOSchema,
  ImportCommitVOSchema,
  ImportSessionInputSchema,
  ImportTablesInputSchema,
  ImportTablesVOSchema,
} from "./types";

/**
 * Dump domain oRPC routes — full-fidelity raw-row export/import used by the
 * `busabase-dump` CLI package's "full" fidelity mode. Composed into the root
 * contract in `contract/busabase.ts` under the `dump` key. Every route is
 * space-context-scoped (the space comes from the request's auth context, same
 * as every other kernel/domain route — never a client-supplied spaceId) and is
 * intended to be gated to admin-level API keys by the host (mirrors how other
 * sensitive kernel surfaces like `vault` are host-gated; busabase-core itself
 * stays host-agnostic and applies no auth).
 */
export const dumpContract = {
  exportTables: oc
    .route({
      method: "POST",
      path: "/dump/export/tables",
      tags: ["Dump"],
      summary: "Export raw rows for one table (cursor-paginated)",
      successDescription:
        "A page of raw rows for the requested table (id-ordered), plus an opaque nextCursor (null at the end). Vault items and webhook secrets are never exportable through this endpoint.",
    })
    .input(ExportTablesInputSchema)
    .output(ExportTablesVOSchema),
  exportAttachment: oc
    .route({
      method: "GET",
      path: "/dump/export/attachments/{attachmentId}/content",
      tags: ["Dump"],
      summary: "Resolve original physical attachment bytes for a full backup",
      successDescription:
        "A direct storage download URL and original metadata for a physical attachment owned by this space or referenced by one of its Assets. Includes attachments with no Asset and legacy attachment rows with a null space id. Does not use the public CDN URL, whose response may rewrite content.",
    })
    .input(ExportAttachmentInputSchema)
    .output(ExportAttachmentVOSchema),
  exportAssetText: oc
    .route({
      method: "GET",
      path: "/dump/export/asset-texts/{assetId}/content",
      tags: ["Dump"],
      summary: "Resolve the download URL for one asset's extracted-text object",
      successDescription:
        "A resolved download URL for the asset's DERIVED text blob (`asset-texts/blobs/sha256/…`) plus its `textStorageKey` and `textContentHash`, so a backup can archive the exact bytes and verify them. `downloadUrl` is null when the row owns no separate object (auto-registered text-kind rows point at their attachment's own key, already covered by the attachment blobs; `status: \"none\"` rows have no text at all).",
    })
    .input(ExportAssetTextInputSchema)
    .output(ExportAssetTextVOSchema),
  exportDocBodies: oc
    .route({
      method: "POST",
      path: "/dump/export/doc-bodies",
      tags: ["Dump"],
      summary: "Read stored node documents and folder readmes",
      successDescription:
        'The raw stored document behind each requested Doc, HTML, whiteboard or workflow — archived nodes included — and each folder\'s optional readme. Rich documents carry nodeType and their exact source in markdown; an HTML folder readme carries bodyFormat: "html". Ids that do not resolve to a Doc, folder, HTML, whiteboard or workflow in this space are omitted rather than failing the batch, and so is a folder that has no readme.',
    })
    .input(ExportDocBodiesInputSchema)
    .output(ExportDocBodiesVOSchema),
  importBegin: oc
    .route({
      method: "POST",
      path: "/dump/import/begin",
      tags: ["Dump"],
      summary: "Begin a full-fidelity import session",
      successDescription:
        "Created an import session for the current space. Refused unless the space's node tree is empty (full-fidelity import preserves original ids and cannot merge into existing data).",
    })
    .input(ImportBeginInputSchema)
    .output(ImportBeginVOSchema),
  importTables: oc
    .route({
      method: "POST",
      path: "/dump/import/tables",
      tags: ["Dump"],
      summary: "Import a batch of raw rows into an open session",
      successDescription:
        'Inserted rows preserving their original ids. `docBodies` ({nodeId, markdown}[]), `attachmentBlobs` ({storageKey, mimeType, base64}[]) and `assetTextBlobs` ({textStorageKey, base64}[]) are pseudo-tables written directly to object storage (none of them are DB rows). A `docBodies` row is a Doc body or a folder readme, decided by the restored node\'s type; a folder row with `bodyFormat: "html"` restores an HTML readme. A row naming a node that is not a Doc or folder in this space, or an HTML row for a Doc, is a 400.',
    })
    .input(ImportTablesInputSchema)
    .output(ImportTablesVOSchema),
  importCommit: oc
    .route({
      method: "POST",
      path: "/dump/import/commit",
      tags: ["Dump"],
      summary: "Finalize an import session",
      successDescription:
        "Ran integrity checks (FK orphans, missing blobs) and closed the session. `ok:false` or a non-empty `warnings` array means the import completed but may be incomplete — inspect before relying on the space.",
    })
    .input(ImportSessionInputSchema)
    .output(ImportCommitVOSchema),
  importAbort: oc
    .route({
      method: "POST",
      path: "/dump/import/abort",
      tags: ["Dump"],
      summary: "Abort an import session",
      successDescription:
        "Best-effort cleanup of everything written so far in this session. Only ever touches the target space validated empty at `importBegin` time.",
    })
    .input(ImportSessionInputSchema)
    .output(ImportAbortVOSchema),
};
