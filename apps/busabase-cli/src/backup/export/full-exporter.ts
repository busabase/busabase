import { createHash } from "node:crypto";
import { type DumpTable, DumpTableSchema } from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import { ArchiveWriter } from "../format/archive-writer.js";
import { FORMAT_VERSION, type Manifest } from "../format/manifest.js";

// Every dump-eligible table, taken straight from the contract enum (the single
// source of truth). Export order is irrelevant — each table is drained
// independently, and the post-loop doc-body / attachment-blob passes read from
// the already-collected `tableRows`. Deriving this instead of hand-maintaining
// a parallel copy is what stops a newly-registered table (e.g. the
// `nodePrincipals` permissions table) from being silently skipped on backup.
const EXPORT_TABLES: DumpTable[] = [...DumpTableSchema.options];

const HISTORY_TABLES: DumpTable[] = [
  "commits",
  "changeRequests",
  "operations",
  "comments",
  "reviews",
  "auditEvents",
];

export interface FullExportOptions {
  client: BusabaseClient;
  outPath: string;
  spaceId: string;
  sourceHost: string;
  includeHistory: boolean;
  toolVersion: string;
  onProgress?: (message: string) => void;
  /**
   * Internal-only override of the per-page row count (production default:
   * 500, matching the contract's default — see `ExportTablesInputSchema` in
   * `busabase-contract/domains/dump/types`). Not exposed as a CLI flag; exists
   * so tests can force the cursor-pagination path to genuinely execute more
   * than once without needing to seed 500+ real rows. Must stay within the
   * contract's `1..2000` bound.
   */
  pageLimit?: number;
}

/**
 * Full-fidelity export: pulls every dump-eligible table via the `dump.exportTables`
 * endpoint (cursor-paginated, raw rows with original ids), doc bodies for
 * every `doc` node via the public `docs.body` read, every asset's bytes via
 * `assets.download`, and every derived extracted-text object via
 * `dump.exportAssetText`. Writes one `tree/<table>.ndjson` per table (NDJSON
 * keeps the format uniform regardless of table size).
 */
export async function exportFull(options: FullExportOptions): Promise<Manifest> {
  const { client, outPath, spaceId, sourceHost, includeHistory, toolVersion, onProgress } = options;
  const pageLimit = options.pageLimit ?? 500;
  const log = onProgress ?? (() => {});
  const writer = ArchiveWriter.create(outPath);
  const tableCounts: Record<string, number> = {};
  const tableRows: Partial<Record<DumpTable, Array<Record<string, unknown>>>> = {};

  const tables = includeHistory
    ? EXPORT_TABLES
    : EXPORT_TABLES.filter((t) => !HISTORY_TABLES.includes(t));

  for (const table of tables) {
    const rows: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    do {
      const page = await client.dump.exportTables({ table, cursor, limit: pageLimit });
      rows.push(...(page.rows as Array<Record<string, unknown>>));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    tableRows[table] = rows;
    tableCounts[table] = rows.length;
    const ndjson = `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length ? "\n" : ""}`;
    await writer.addBuffer(`tree/${table}.ndjson`, ndjson);
    log(`exported ${table}: ${rows.length} rows`);
  }

  // Doc bodies — one markdown entry per `doc` node, read via the public docs.get
  // endpoint (doc bodies live in object storage, not a dump-eligible DB table).
  const docNodes = (tableRows.nodes ?? []).filter((n) => n.type === "doc");
  let docBodyCount = 0;
  for (const node of docNodes) {
    const nodeId = node.id as string;
    const doc = await client.docs.get({ nodeId });
    await writer.addBuffer(`docs/${nodeId}.md`, doc.body ?? "");
    docBodyCount += 1;
  }
  log(`exported ${docBodyCount} doc bodies`);

  // Attachment blobs — download every exported Asset's bytes and archive them
  // keyed by the OWNING `busabase_attachments` row's own `storageKey` (written
  // to `attachments.ndjson` next to the `attachments` table dump above), not
  // by content hash — the importer restores each blob at that exact key via
  // `storage.uploadFileToKey` before the `attachments` row that FKs into it is
  // inserted, so a re-imported Asset's `assets.download` resolves immediately.
  const attachmentsById = new Map((tableRows.attachments ?? []).map((a) => [a.id as string, a]));
  const attachmentBlobRows: Array<{ storageKey: string; mimeType: string; base64: string }> = [];
  let blobCount = 0;
  let blobBytes = 0;
  const skippedAssets: string[] = [];
  for (const asset of tableRows.assets ?? []) {
    const assetId = asset.id as string;
    const attachment = attachmentsById.get(asset.attachmentId as string);
    // A single asset row with no resolvable bytes (e.g. an orphaned row whose
    // attachment was already removed) must not abort the whole space backup
    // — surface it as a warning instead. `dump.importCommit`'s integrity pass
    // also cross-checks `assets` rows against blobs actually present in the
    // archive, so a caller can see this gap on the import side too.
    try {
      if (!attachment) throw new Error("no matching attachments row (orphaned asset)");
      const download = await client.assets.download({ assetId });
      // A local (non-S3) server returns a root-relative `downloadUrl` (e.g.
      // `/api/dev/attachment/...`) meant to be fetched same-origin from the
      // browser. `busabase-cli backup` runs out-of-process, so it must resolve
      // that against the configured server host itself — found live against a real
      // seeded server (a bare `fetch("/api/...")` throws "Failed to parse
      // URL" in Node), not just inferred from reading the code.
      const resolvedUrl = new URL(download.downloadUrl, sourceHost).toString();
      const res = await fetch(resolvedUrl);
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      attachmentBlobRows.push({
        storageKey: attachment.storageKey as string,
        mimeType: download.mimeType,
        base64: buf.toString("base64"),
      });
      blobCount += 1;
      blobBytes += buf.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skippedAssets.push(assetId);
      log(`  WARNING: could not download asset ${assetId}, skipping its blob (${message})`);
    }
  }
  const blobNdjson = `${attachmentBlobRows.map((row) => JSON.stringify(row)).join("\n")}${
    attachmentBlobRows.length ? "\n" : ""
  }`;
  await writer.addBuffer("tree/attachmentBlobs.ndjson", blobNdjson);
  log(
    `exported ${blobCount} attachment blobs (${blobBytes} bytes), skipped ${skippedAssets.length}`,
  );

  // Asset-text blobs — the extracted-text objects `busabase_asset_texts` rows
  // point at (Drive Grep Retrieval). The ROWS were always exported (assetTexts
  // is a dump table); their BYTES were not, so a restore produced rows saying
  // `status: "present"` over objects that had never been captured and grep
  // silently returned no matches for text the source could find. Same shape as
  // the `nodePrincipals` loss: the table is in the dump set, the content it
  // depends on is not.
  //
  // Only rows that own a SEPARATE object are archived here. The server decides
  // that (see `exportAssetTextBlob`) and returns `downloadUrl: null` otherwise
  // — auto-registered text-kind rows point at the owning attachment's own
  // `storageKey`, whose bytes the attachment pass above already wrote, so
  // re-archiving them would duplicate bytes and have two entries fight over
  // one key on restore. Keys are content-addressed, so two assets holding
  // identical text share one key: dedupe, or the archive carries the same
  // bytes twice.
  const textBlobRows: Array<{ textStorageKey: string; base64: string }> = [];
  const seenTextKeys = new Set<string>();
  let textBlobCount = 0;
  let textBlobBytes = 0;
  const skippedAssetTexts: string[] = [];
  for (const assetText of tableRows.assetTexts ?? []) {
    const assetId = assetText.assetId as string;
    try {
      const info = await client.dump.exportAssetText({ assetId });
      // No separate object to archive (auto-registered row, or `status: "none"`).
      if (!info.downloadUrl) continue;
      if (seenTextKeys.has(info.textStorageKey)) continue;

      const resolvedUrl = new URL(info.downloadUrl, sourceHost).toString();
      const res = await fetch(resolvedUrl);
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      // The key IS the sha256 of these bytes, so a text that comes back even
      // one byte different (a line-oriented reader dropping a trailing
      // newline, a proxy re-encoding the body) would restore to a key that no
      // longer matches its own `textContentHash`. Verify rather than assume —
      // a corrupt backup that reports success is worse than a loud skip.
      if (info.textContentHash) {
        const actual = `sha256:${createHash("sha256").update(buf).digest("hex")}`;
        if (actual !== info.textContentHash) {
          throw new Error(
            `content hash mismatch (expected ${info.textContentHash}, downloaded ${actual})`,
          );
        }
      }
      seenTextKeys.add(info.textStorageKey);
      textBlobRows.push({ textStorageKey: info.textStorageKey, base64: buf.toString("base64") });
      textBlobCount += 1;
      textBlobBytes += buf.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skippedAssetTexts.push(assetId);
      log(
        `  WARNING: could not download text for asset ${assetId}, skipping its blob (${message})`,
      );
    }
  }
  const textBlobNdjson = `${textBlobRows.map((row) => JSON.stringify(row)).join("\n")}${
    textBlobRows.length ? "\n" : ""
  }`;
  await writer.addBuffer("tree/assetTextBlobs.ndjson", textBlobNdjson);
  log(
    `exported ${textBlobCount} asset-text blobs (${textBlobBytes} bytes), skipped ${skippedAssetTexts.length}`,
  );

  const manifestWithoutChecksum: Omit<Manifest, "checksum"> = {
    formatVersion: FORMAT_VERSION,
    toolVersion,
    exportedAt: new Date().toISOString(),
    spaceId,
    sourceHost,
    fidelity: "full",
    excludesSecrets: true,
    tables: tableCounts,
    blobCount,
    blobBytes,
    textBlobCount,
    textBlobBytes,
  };
  return writer.finalize(manifestWithoutChecksum);
}
