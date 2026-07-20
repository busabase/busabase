import type { DumpTable } from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import type { ReadArchiveResult } from "../format/archive-reader.js";

/**
 * FK-safe insert order (parents before children). Unlike the export list this
 * order is load-bearing, so it stays hand-maintained — but a drift guard
 * (`table-lists.test.ts`) asserts it covers exactly the contract's
 * `DumpTableSchema`, so a table added to the contract can't be silently dropped
 * from import.
 */
export const IMPORT_ORDER: DumpTable[] = [
  "nodes",
  // `nodeId` / `sourceNodeId` FK into busabase_nodes — must follow "nodes".
  "nodePrincipals",
  "bases",
  "baseFields",
  "views",
  "commits",
  "changeRequests",
  "operations",
  "records",
  "fieldValues",
  "recordLinks",
  "attachments",
  "assets",
  "assetUsages",
  "assetTexts",
  "comments",
  "reviews",
  "auditEvents",
];

const BATCH_SIZE = 200;

export interface FullImportOptions {
  client: BusabaseClient;
  archive: ReadArchiveResult;
  onProgress?: (message: string) => void;
}

/**
 * Full-fidelity import: begins a dump session (server refuses unless the
 * target space is empty), uploads every attachment blob (`attachmentBlobs`
 * pseudo-table, written directly to storage at its original key) BEFORE the
 * `attachments` table rows that FK-reference those keys, likewise every
 * extracted-text blob (`assetTextBlobs`) before the `assetTexts` rows that
 * point at them, replays every other
 * table in dependency order via `dump.importTables` (preserving original
 * ids), uploads doc bodies as the `docBodies` pseudo-table, and commits.
 */
export async function importFull(
  options: FullImportOptions,
): Promise<{ ok: boolean; warnings: string[] }> {
  const { client, archive, onProgress } = options;
  const log = onProgress ?? (() => {});

  const { sessionId } = await client.dump.importBegin();
  try {
    const blobBuf = archive.entries.get("tree/attachmentBlobs.ndjson");
    if (blobBuf) {
      const blobRows = blobBuf
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      for (let i = 0; i < blobRows.length; i += BATCH_SIZE) {
        const batch = blobRows.slice(i, i + BATCH_SIZE);
        await client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: batch });
      }
      log(`imported ${blobRows.length} attachment blobs`);
    }

    // Extracted-text objects, restored to their exact `textStorageKey` BEFORE
    // the `assetTexts` rows that reference them are inserted (same ordering
    // rule as attachment blobs above; `assetTexts` sits far later in
    // IMPORT_ORDER, so this is comfortably ahead of it). Absent from archives
    // written before asset-text blobs were captured — those simply skip this
    // block, and `importCommit`'s integrity pass reports the missing bytes
    // instead of restoring a space whose text silently isn't searchable.
    const textBlobBuf = archive.entries.get("tree/assetTextBlobs.ndjson");
    if (textBlobBuf) {
      const textBlobRows = textBlobBuf
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      for (let i = 0; i < textBlobRows.length; i += BATCH_SIZE) {
        const batch = textBlobRows.slice(i, i + BATCH_SIZE);
        await client.dump.importTables({ sessionId, table: "assetTextBlobs", rows: batch });
      }
      log(`imported ${textBlobRows.length} asset-text blobs`);
    }

    for (const table of IMPORT_ORDER) {
      const buf = archive.entries.get(`tree/${table}.ndjson`);
      if (!buf) continue;
      const rows = buf
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await client.dump.importTables({ sessionId, table, rows: batch });
      }
      log(`imported ${table}: ${rows.length} rows`);
    }

    const docBodyRows = [...archive.entries.entries()]
      .filter(([path]) => path.startsWith("docs/") && path.endsWith(".md"))
      .map(([path, buf]) => ({
        nodeId: path.slice("docs/".length, -".md".length),
        markdown: buf.toString("utf8"),
      }));
    if (docBodyRows.length > 0) {
      await client.dump.importTables({ sessionId, table: "docBodies", rows: docBodyRows });
      log(`imported ${docBodyRows.length} doc bodies`);
    }

    const result = await client.dump.importCommit({ sessionId });
    return result;
  } catch (error) {
    await client.dump.importAbort({ sessionId }).catch(() => undefined);
    throw error;
  }
}
