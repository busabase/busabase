import type { Readable } from "node:stream";
import type { DumpTable } from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import { drainEntry, readEntryText, streamArchive } from "../format/archive-reader.js";

/**
 * FK-safe insert order (parents before children). Unlike the export list this
 * order is load-bearing, so it stays hand-maintained — but a drift guard
 * (`table-lists.test.ts`) asserts it covers exactly the contract's
 * `DumpTableSchema`, so a table added to the contract can't be silently dropped
 * from import.
 *
 * This is ALSO the order `full-exporter.ts` now writes `tree/*.ndjson`
 * entries into the archive (blobs first, then this exact sequence, then doc
 * bodies) — `importFull` below processes entries strictly in the order it
 * encounters them while streaming the file once, so the archive's physical
 * layout is what actually enforces FK-safety now, not an in-memory reorder.
 * If that write order and this array drift apart, restore breaks with a
 * plain FK-violation error, not a silent corruption — see the matching note
 * in `full-exporter.ts`.
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
/**
 * Also cap each batch by raw bytes, not just row count. `BATCH_SIZE` rows is
 * fine for small metadata tables, but `attachmentBlobs`/`assetTextBlobs` rows
 * carry base64-encoded file bytes — a real production space's attachments
 * (average ~700KB base64'd) turned 200 rows into a ~140MB single POST body,
 * which the server rejected outright as a malformed request (its own decode
 * step throws before ever reaching our schema, so the real cause — a body
 * too large for whatever's parsing it — surfaces as a generic `BAD_REQUEST`
 * with no size mentioned anywhere). Flush on whichever limit hits first.
 */
const MAX_BATCH_BYTES = 4 * 1024 * 1024;

const TABLE_ENTRY_PREFIX = "tree/";
const TABLE_ENTRY_SUFFIX = ".ndjson";
const ATTACHMENT_BLOBS_ENTRY = `${TABLE_ENTRY_PREFIX}attachmentBlobs${TABLE_ENTRY_SUFFIX}`;
const ASSET_TEXT_BLOBS_ENTRY = `${TABLE_ENTRY_PREFIX}assetTextBlobs${TABLE_ENTRY_SUFFIX}`;

export interface FullImportOptions {
  client: BusabaseClient;
  /** Path to a `.bbdump` archive already integrity-verified via `verifyArchive`. */
  archivePath: string;
  /** The archive's `manifest.spaceId` — the space it was ORIGINALLY exported from, needed so the server can remap the root node deterministically instead of guessing from row content. */
  sourceSpaceId: string;
  onProgress?: (message: string) => void;
}

/**
 * Parse NDJSON line-by-line from a stream (a small hand-rolled splitter, not
 * `node:readline` — see below) and flush rows to `send` in batches — bounded
 * by BOTH `BATCH_SIZE` rows and `MAX_BATCH_BYTES` raw bytes, whichever comes
 * first — as they arrive, never collecting the whole entry into one
 * array/string/buffer first. This is what lets a multi-gigabyte
 * `fieldValues.ndjson` or `attachmentBlobs.ndjson` (thousands of attachments'
 * base64 bytes) import without holding all of it in memory at once, AND
 * without ever sending one request body too large for the server to parse.
 */
// Exported for `full-importer.test.ts` only — not part of the module's public
// API surface used by `commands.ts`.
export async function streamNdjsonRows(
  body: Readable,
  send: (rows: Array<Record<string, unknown>>) => Promise<unknown>,
): Promise<number> {
  // `body` is tar-stream's raw Buffer-mode entry stream. `setEncoding('utf8')`
  // routes chunk decoding through the stream's own `StringDecoder`, so a
  // multi-byte UTF-8 character (CJK text is common in real commit
  // messages/payloads) split across two chunks still decodes correctly
  // instead of mangling into an unterminated string.
  //
  // Split lines with a plain `indexOf("\n")` loop, not `node:readline`, as
  // defense in depth: reading a real multi-gigabyte production archive
  // through `node:readline` over this same kind of stream corrupted entries
  // deep into a large table (`Unterminated string in JSON`, one row split
  // across two "lines") even with encoding set. The primary fix was
  // removing the live `ZstdDecompress → tar-stream` pipe this reads from
  // (see `archive-reader.ts`'s `openTarStream`) — the exact mechanism was
  // never pinned down to being readline-specific vs. an artifact of that
  // live pipe, so this manual splitter avoids the untrusted code path
  // entirely rather than assume it's now safe.
  body.setEncoding("utf8");
  let buffer = "";
  let batch: Array<Record<string, unknown>> = [];
  let batchBytes = 0;
  let count = 0;
  for await (const chunk of body) {
    buffer += chunk as string;
    let newlineIndex: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard incremental-parse idiom
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      batch.push(JSON.parse(line));
      batchBytes += Buffer.byteLength(line, "utf8");
      count += 1;
      if (batch.length >= BATCH_SIZE || batchBytes >= MAX_BATCH_BYTES) {
        await send(batch);
        batch = [];
        batchBytes = 0;
      }
    }
  }
  if (buffer.length > 0) {
    batch.push(JSON.parse(buffer));
    count += 1;
  }
  if (batch.length > 0) await send(batch);
  return count;
}

/**
 * Full-fidelity import: begins a dump session (server refuses unless the
 * target space is empty), then streams the archive ONCE — uploading every
 * attachment blob (`attachmentBlobs` pseudo-table, written directly to
 * storage at its original key) BEFORE the `attachments` table rows that FK-
 * reference those keys, likewise every extracted-text blob
 * (`assetTextBlobs`) before the `assetTexts` rows that point at them,
 * replaying every other table in dependency order via `dump.importTables`
 * (preserving original ids), uploading doc bodies as the `docBodies`
 * pseudo-table, and finally committing. The archive must already be
 * integrity-verified (`verifyArchive`) before this is called.
 */
export async function importFull(
  options: FullImportOptions,
): Promise<{ ok: boolean; warnings: string[] }> {
  const { client, archivePath, sourceSpaceId, onProgress } = options;
  const log = onProgress ?? (() => {});

  const { sessionId } = await client.dump.importBegin({ sourceSpaceId });
  try {
    const docBodyRows: Array<{ nodeId: string; markdown: string }> = [];

    await streamArchive(archivePath, async (entry) => {
      if (entry.path === ATTACHMENT_BLOBS_ENTRY) {
        const n = await streamNdjsonRows(entry.body, (rows) =>
          client.dump.importTables({ sessionId, table: "attachmentBlobs", rows }),
        );
        log(`imported ${n} attachment blobs`);
        return;
      }
      if (entry.path === ASSET_TEXT_BLOBS_ENTRY) {
        const n = await streamNdjsonRows(entry.body, (rows) =>
          client.dump.importTables({ sessionId, table: "assetTextBlobs", rows }),
        );
        log(`imported ${n} asset-text blobs`);
        return;
      }
      if (entry.path.startsWith(TABLE_ENTRY_PREFIX) && entry.path.endsWith(TABLE_ENTRY_SUFFIX)) {
        const table = entry.path.slice(
          TABLE_ENTRY_PREFIX.length,
          -TABLE_ENTRY_SUFFIX.length,
        ) as DumpTable;
        if (!IMPORT_ORDER.includes(table)) {
          // A pseudo-table entry this version doesn't know about yet, or a
          // future table archived by a newer CLI — skip forward-compatibly
          // rather than failing the whole restore.
          await drainEntry(entry.body);
          return;
        }
        const n = await streamNdjsonRows(entry.body, (rows) =>
          client.dump.importTables({ sessionId, table, rows }),
        );
        log(`imported ${table}: ${n} rows`);
        return;
      }
      if (entry.path.startsWith("docs/") && entry.path.endsWith(".md")) {
        const nodeId = entry.path.slice("docs/".length, -".md".length);
        const markdown = await readEntryText(entry.body);
        docBodyRows.push({ nodeId, markdown });
        return;
      }
      // manifest.json (already read by `verifyArchive`) or any other unknown
      // entry — drain it so tar-stream can advance, but do nothing with it.
      await drainEntry(entry.body);
    });

    if (docBodyRows.length > 0) {
      for (let i = 0; i < docBodyRows.length; i += BATCH_SIZE) {
        await client.dump.importTables({
          sessionId,
          table: "docBodies",
          rows: docBodyRows.slice(i, i + BATCH_SIZE),
        });
      }
      log(`imported ${docBodyRows.length} doc bodies`);
    }

    const result = await client.dump.importCommit({ sessionId });
    return result;
  } catch (error) {
    await client.dump.importAbort({ sessionId }).catch(() => undefined);
    throw error;
  }
}
