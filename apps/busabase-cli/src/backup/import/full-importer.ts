import { constants as bufferConstants } from "node:buffer";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { DumpTable } from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import {
  drainEntry,
  openVerifiedArchive,
  readEntryText,
  type StreamedArchiveEntry,
  streamArchive,
} from "../format/archive-reader.js";
import { type Manifest, ManifestSchema } from "../format/manifest.js";
import { isSafeNodeIdentity } from "../node-identity.js";

interface RawArchiveBlob {
  key: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  table: "attachmentBlobs" | "assetTextBlobs";
}

/** Raw v2 entries never materialize a whole object or its base64 representation. */
export async function importRawArchiveBlob(
  body: Readable,
  info: RawArchiveBlob,
  send: (rows: Array<Record<string, unknown>>) => Promise<unknown>,
  blobChunkProtocol?: 1,
): Promise<void> {
  const field = info.table === "attachmentBlobs" ? "storageKey" : "textStorageKey";
  const metadata =
    info.table === "attachmentBlobs"
      ? { [field]: info.key, mimeType: info.mimeType }
      : { [field]: info.key };
  if (info.bytes > BLOB_INLINE_MAX_BYTES && blobChunkProtocol !== 1)
    throw new Error(
      "This server cannot restore large raw blobs safely. Upgrade the server for chunked full restores.",
    );
  const hash = createHash("sha256");
  let size = 0;
  let partNumber = 1;
  let buffered: Buffer[] = [];
  let bufferedBytes = 0;
  const totalParts = Math.ceil(info.bytes / BLOB_PART_BYTES);
  let finalPart: Buffer | undefined;
  const sendPart = async (bytes: Buffer) =>
    send([
      {
        ...metadata,
        base64: bytes.toString("base64"),
        chunk: { partNumber: partNumber++, totalParts, sizeBytes: info.bytes, sha256: info.sha256 },
      },
    ]);
  // Small blobs keep the old request shape for compatible older servers.
  if (info.bytes <= BLOB_INLINE_MAX_BYTES) {
    for await (const chunk of body) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > info.bytes)
        throw new Error(`Raw blob ${info.key} exceeds its declared byte count`);
      hash.update(bytes);
      buffered.push(bytes);
    }
    if (size !== info.bytes || hash.digest("hex") !== info.sha256)
      throw new Error(`Raw blob ${info.key} has incorrect size or SHA-256`);
    await send([{ ...metadata, base64: Buffer.concat(buffered, size).toString("base64") }]);
    return;
  }
  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > info.bytes) throw new Error(`Raw blob ${info.key} exceeds its declared byte count`);
    hash.update(bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const take = Math.min(BLOB_PART_BYTES - bufferedBytes, bytes.length - offset);
      buffered.push(bytes.subarray(offset, offset + take));
      bufferedBytes += take;
      offset += take;
      if (bufferedBytes === BLOB_PART_BYTES) {
        const part = Buffer.concat(buffered, bufferedBytes);
        buffered = [];
        bufferedBytes = 0;
        // Hold the final part until EOF and the archive hash have been checked.
        if (partNumber === totalParts) finalPart = part;
        else await sendPart(part);
      }
    }
  }
  if (bufferedBytes > 0) finalPart = Buffer.concat(buffered, bufferedBytes);
  if (size !== info.bytes || hash.digest("hex") !== info.sha256 || !finalPart)
    throw new Error(`Raw blob ${info.key} has incorrect size or SHA-256`);
  await sendPart(finalPart);
}

async function readRawBlobMetadata(
  body: Readable,
  group: string,
  id: string,
): Promise<RawArchiveBlob> {
  const pieces: Buffer[] = [];
  let bytes = 0;
  for await (const part of body) {
    const piece = Buffer.isBuffer(part) ? part : Buffer.from(part);
    bytes += piece.length;
    if (bytes > 16 * 1024)
      throw new Error("Raw blob metadata is larger than its supported envelope");
    pieces.push(piece);
  }
  const input = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pieces, bytes)),
  ) as Record<string, unknown>;
  const key = group === "attachments" ? input.storageKey : input.textStorageKey;
  if (
    typeof key !== "string" ||
    typeof input.bytes !== "number" ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 0 ||
    typeof input.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.sha256) ||
    createHash("sha256").update(key, "utf8").digest("hex") !== id
  )
    throw new Error("Raw blob metadata has invalid identity, size or hash");
  return {
    key,
    bytes: input.bytes,
    sha256: input.sha256,
    table: group === "attachments" ? "attachmentBlobs" : "assetTextBlobs",
    mimeType: typeof input.mimeType === "string" ? input.mimeType : "application/octet-stream",
  };
}

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
  "nodeShares",
  "favorites",
  "nodeSubscriptions",
  "spaceInstructions",
  "spaceWelcome",
  "embedLinks",
  "bases",
  "baseFields",
  "views",
  "forms",
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
  "commentMentions",
  "reviews",
  "auditEvents",
  "workflowRuns",
  "workflowTriggers",
  "webhookRules",
  "webhookDeliveries",
  "agentSessions",
  "agentSessionEvents",
  "agentSessionCommands",
  "routerGrants",
  "routerConnections",
];

/** Integrity verification can inspect newer manifests; applying one must be complete. */
export function assertSupportedRestoreTables(tables: Readonly<Record<string, number>>): void {
  const supported = new Set<string>(IMPORT_ORDER);
  const unknown = Object.keys(tables).filter((table) => !supported.has(table));
  if (unknown.length > 0)
    throw new Error(
      `Archive declares unsupported table(s): ${unknown.join(", ")}. Update busabase-cli before restoring; this version cannot restore the archive completely.`,
    );
}

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
/** Six MiB decoded parts are S3-valid and only eight MiB as JSON base64. */
const BLOB_PART_BYTES = 6 * 1024 * 1024;
const BLOB_INLINE_MAX_BYTES = 12 * 1024 * 1024;
const BLOB_PART_BASE64_CHARS = (BLOB_PART_BYTES / 3) * 4;

/** Send a logical blob once, using bounded requests for large single rows. */
export async function sendRestoreBlobRows(
  rows: Array<Record<string, unknown>>,
  send: (rows: Array<Record<string, unknown>>) => Promise<unknown>,
  blobChunkProtocol?: 1,
): Promise<void> {
  let pending: Array<Record<string, unknown>> = [];
  const flush = async () => {
    if (pending.length > 0) {
      await send(pending);
      pending = [];
    }
  };
  for (const row of rows) {
    const base64 = row.base64;
    if (typeof base64 !== "string") throw new Error("Archive blob row has no base64 bytes");
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    const sizeBytes = (base64.length / 4) * 3 - padding;
    if (sizeBytes <= BLOB_INLINE_MAX_BYTES) {
      pending.push(row);
      continue;
    }
    await flush();
    if (blobChunkProtocol !== 1)
      throw new Error(
        "This server cannot restore large blobs safely. Upgrade the server to support chunked full restores, then retry this archive.",
      );
    if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
      throw new Error("Archive blob is not canonical base64");
    const hash = createHash("sha256");
    for (let offset = 0; offset < base64.length; offset += BLOB_PART_BASE64_CHARS) {
      hash.update(Buffer.from(base64.slice(offset, offset + BLOB_PART_BASE64_CHARS), "base64"));
    }
    const sha256 = hash.digest("hex");
    const totalParts = Math.ceil(sizeBytes / BLOB_PART_BYTES);
    const { base64: _bytes, ...metadata } = row;
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      await send([
        {
          ...metadata,
          base64: base64.slice(
            (partNumber - 1) * BLOB_PART_BASE64_CHARS,
            partNumber * BLOB_PART_BASE64_CHARS,
          ),
          chunk: { partNumber, totalParts, sizeBytes, sha256 },
        },
      ]);
    }
  }
  await flush();
}

const TABLE_ENTRY_PREFIX = "tree/";
const TABLE_ENTRY_SUFFIX = ".ndjson";
const ATTACHMENT_BLOBS_ENTRY = `${TABLE_ENTRY_PREFIX}attachmentBlobs${TABLE_ENTRY_SUFFIX}`;
const ASSET_TEXT_BLOBS_ENTRY = `${TABLE_ENTRY_PREFIX}assetTextBlobs${TABLE_ENTRY_SUFFIX}`;

export interface FullImportOptions {
  client: BusabaseClient;
  /** Path to a `.bbdump` archive already integrity-verified via `verifyArchive`. */
  archivePath: string;
  /** Verified archive metadata; only a declared consistent snapshot suppresses legacy view repair. */
  manifest?: Manifest;
  /** Replay an already verified private tar without re-decoding the original file. */
  streamEntries?: (onEntry: (entry: StreamedArchiveEntry) => Promise<void>) => Promise<void>;
  /** The archive's `manifest.spaceId` — the space it was ORIGINALLY exported from, needed so the server can remap the root node deterministically instead of guessing from row content. */
  sourceSpaceId: string;
  /**
   * Continue a restore whose process was killed partway through (Ctrl-C, OOM,
   * a dropped connection). Replays the whole archive with the server skipping
   * rows that already landed, and — critically — does NOT roll back on
   * failure, since the point is to keep the progress an earlier attempt made.
   */
  resume?: boolean;
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
  // Keep the tar entry in raw Buffer mode. Split decoded lines incrementally,
  // retaining only one incomplete row and the bounded outgoing batch.
  // tar-stream's streamx setEncoding uses its own decoder, which can replace
  // a split CJK sequence even though the raw archive checksum is correct.
  // Decode the original bytes ourselves and reject invalid UTF-8 rather than
  // silently injecting replacement characters into a restored JSON value.
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let segments: string[] = [];
  let lineLength = 0;
  let batch: Array<Record<string, unknown>> = [];
  let batchBytes = 0;
  let count = 0;
  const addSegment = (segment: string) => {
    lineLength += segment.length;
    if (lineLength > bufferConstants.MAX_STRING_LENGTH) {
      throw new Error(
        "An archive NDJSON row exceeds this Node runtime's maximum string length. This legacy base64-row format cannot restore a single blob this large; use an archive format with raw streamed blob entries.",
      );
    }
    if (segment.length > 0) segments.push(segment);
  };
  const sendLine = async (line: string) => {
    if (!line) return;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (batch.length > 0 && batchBytes + lineBytes > MAX_BATCH_BYTES) {
      await send(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(JSON.parse(line));
    batchBytes += lineBytes;
    count++;
    if (batch.length >= BATCH_SIZE || batchBytes >= MAX_BATCH_BYTES) {
      await send(batch);
      batch = [];
      batchBytes = 0;
    }
  };
  const consumeText = async (text: string) => {
    let start = 0;
    let newlineIndex: number;
    // Search only the new chunk. Re-scanning a 258MB base64 prefix for every
    // 64KB chunk makes a single real attachment quadratic in time and copies.
    // biome-ignore lint/suspicious/noAssignInExpressions: incremental line splitter
    while ((newlineIndex = text.indexOf("\n", start)) !== -1) {
      addSegment(text.slice(start, newlineIndex));
      const line = segments.join("");
      segments = [];
      lineLength = 0;
      await sendLine(line);
      start = newlineIndex + 1;
    }
    addSegment(text.slice(start));
  };
  for await (const chunk of body) {
    await consumeText(typeof chunk === "string" ? chunk : utf8.decode(chunk, { stream: true }));
  }
  await consumeText(utf8.decode());
  if (lineLength > 0) await sendLine(segments.join(""));
  if (batch.length > 0) await send(batch);
  return count;
}

/**
 * `nodes.parentId` references this same table. Export scans by id, so a parent
 * can land hundreds of rows after its child and fail a later restore batch's
 * FK check. Only this table needs buffering: validate the graph, then emit a
 * stable parent-first order before writing any node rows. Keep the large
 * record/history/blob tables streaming.
 */
function orderNodesParentFirst(rows: Array<Record<string, unknown>>) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!isSafeNodeIdentity(row.id)) {
      throw new Error("Cannot restore nodes: a node id is not a safe single segment.");
    }
    if (byId.has(row.id)) {
      throw new Error(`Cannot restore nodes: duplicate node id "${row.id}" in the archive.`);
    }
    byId.set(row.id, row);
  }

  const children = new Map<string, Array<Record<string, unknown>>>();
  const ordered: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (row.parentId === null || row.parentId === undefined) {
      ordered.push(row);
      continue;
    }
    if (typeof row.parentId !== "string" || !byId.has(row.parentId)) {
      throw new Error(
        `Cannot restore node "${row.id}": parent "${String(row.parentId)}" is missing from the archive's nodes table.`,
      );
    }
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row);
    children.set(row.parentId, siblings);
  }

  // A queue rather than recursive DFS also handles deeply nested trees without
  // exhausting the JavaScript call stack. Input order is retained among siblings.
  for (let index = 0; index < ordered.length; index += 1) {
    for (const child of children.get(ordered[index].id as string) ?? []) ordered.push(child);
  }
  if (ordered.length !== rows.length) {
    const visited = new Set(ordered.map((row) => row.id));
    const blocked = rows
      .filter((row) => !visited.has(row.id))
      .slice(0, 5)
      .map((row) => row.id)
      .join(", ");
    throw new Error(`Cannot restore nodes: parent cycle blocks node(s) ${blocked}.`);
  }
  return ordered;
}

async function importNodeRows(
  body: Readable,
  send: (rows: Array<Record<string, unknown>>) => Promise<unknown>,
): Promise<number> {
  const rows: Array<Record<string, unknown>> = [];
  await streamNdjsonRows(body, async (batch) => {
    rows.push(...batch);
  });
  const ordered = orderNodesParentFirst(rows);
  let batch: Array<Record<string, unknown>> = [];
  let batchBytes = 0;
  for (const row of ordered) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8");
    if (
      batch.length > 0 &&
      (batch.length >= BATCH_SIZE || batchBytes + rowBytes > MAX_BATCH_BYTES)
    ) {
      await send(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(row);
    batchBytes += rowBytes;
  }
  if (batch.length > 0) await send(batch);
  return ordered.length;
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
): Promise<{ ok: boolean; warnings: string[]; notices?: string[] }> {
  if (!options.manifest) {
    if (options.streamEntries) {
      let manifest: Manifest | undefined;
      await options.streamEntries(async (entry) => {
        if (entry.path === "manifest.json") {
          if (manifest) throw new Error("Duplicate archive manifest.");
          manifest = ManifestSchema.parse(JSON.parse(await readEntryText(entry.body)));
        } else await drainEntry(entry.body);
      });
      if (!manifest) throw new Error("Verified archive has no manifest.");
      return importFull({ ...options, manifest });
    }
    const verified = await openVerifiedArchive(options.archivePath);
    try {
      return await importFull({
        ...options,
        manifest: verified.manifest,
        streamEntries: verified.streamEntries,
      });
    } finally {
      await verified.cleanup();
    }
  }
  const { client, archivePath, sourceSpaceId, resume = false, onProgress } = options;
  const log = onProgress ?? (() => {});

  if (options.manifest && options.manifest.spaceId !== sourceSpaceId)
    throw new Error("Verified manifest source space differs from the restore input.");
  const manifest = options.manifest;
  assertSupportedRestoreTables(manifest.tables);
  const expectedTables = Object.fromEntries(
    IMPORT_ORDER.map((table) => [table, manifest.tables[table] ?? 0]),
  );
  const preserveViewMetadata = manifest.sqlCapture?.mode === "repeatable-read";
  const { sessionId, blobChunkProtocol, exactReplayProtocol } = await client.dump.importBegin({
    sourceSpaceId,
    resume,
    sourceArchiveChecksum: manifest.checksum,
    expectedTables,
    ...(preserveViewMetadata ? { preserveViewMetadata: true } : {}),
  });
  try {
    if ((resume || manifest.formatVersion >= 3) && exactReplayProtocol !== 1)
      throw new Error(
        "The target server does not acknowledge exactReplayProtocol:1. Update the server before restoring this archive; no blob, document or SQL row was written.",
      );
    // The acknowledged modern protocol accepts opaque SQL arrays. This keeps
    // arbitrary nested JSON keys outside generic RPC object sanitization.
    const sqlRows = (rows: Array<Record<string, unknown>>) =>
      exactReplayProtocol === 1 ? { rowsJson: JSON.stringify(rows) } : { rows };
    const replay = options.streamEntries ?? ((onEntry) => streamArchive(archivePath, onEntry));
    if (resume) {
      log("Validating all existing SQL rows before any stored object is written");
      const seenTables = new Set<DumpTable>();
      const validate = async (
        table: DumpTable,
        rows: Array<Record<string, unknown>>,
        expectedRows: number,
        end = false,
      ) => {
        const ack = await client.dump.importTables({
          sessionId,
          table,
          ...sqlRows(rows),
          validateOnly: true,
          ...(end ? { validationComplete: true } : {}),
        });
        if (
          ack.inserted !== 0 ||
          ack.validated !== true ||
          ack.validationComplete !== end ||
          ack.validatedRows !== expectedRows
        )
          throw new Error(
            `Target did not acknowledge read-only exact validation for ${table}; no stored object was written.`,
          );
      };
      // Confirm validateOnly acknowledgement with zero rows before handing a
      // target any non-empty SQL batch (a partial/old implementation stays inert).
      await validate("nodes", [], 0);
      await replay(async (entry) => {
        if (entry.path === ATTACHMENT_BLOBS_ENTRY || entry.path === ASSET_TEXT_BLOBS_ENTRY) {
          await drainEntry(entry.body);
          return;
        }
        if (entry.path.startsWith(TABLE_ENTRY_PREFIX) && entry.path.endsWith(TABLE_ENTRY_SUFFIX)) {
          const table = entry.path.slice(
            TABLE_ENTRY_PREFIX.length,
            -TABLE_ENTRY_SUFFIX.length,
          ) as DumpTable;
          if (!IMPORT_ORDER.includes(table) || seenTables.has(table))
            throw new Error(`Unsupported or duplicate SQL table in preflight: ${table}`);
          seenTables.add(table);
          let rowsSeen = 0;
          const consume = table === "nodes" ? importNodeRows : streamNdjsonRows;
          await consume(entry.body, async (rows) => {
            rowsSeen += rows.length;
            await validate(table, rows, rowsSeen);
          });
          if (rowsSeen !== expectedTables[table])
            throw new Error(`Archive row count differs from its declared ${table} count`);
          await validate(table, [], rowsSeen, true);
          return;
        }
        if (
          entry.path === "manifest.json" ||
          entry.path === ATTACHMENT_BLOBS_ENTRY ||
          entry.path === ASSET_TEXT_BLOBS_ENTRY ||
          /^blobs\/(attachments|asset-texts)\/[a-f0-9]{64}\.(json|bin)$/.test(entry.path) ||
          /^docs\/[^/]+\.(md|html)$/.test(entry.path) ||
          /^rich\/[^/]+\.(html|whiteboard\.json|workflow\.json)$/.test(entry.path)
        ) {
          await drainEntry(entry.body);
          return;
        }
        throw new Error(
          `Unrecognized archive entry ${entry.path}; refusing to skip it during resume validation`,
        );
      });
      for (const table of IMPORT_ORDER)
        if (!seenTables.has(table)) {
          if (expectedTables[table] !== 0)
            throw new Error(`Archive is missing declared SQL table ${table}`);
          await validate(table, [], 0, true);
        }
      log("All SQL rows passed exact read-only resume validation");
    }
    const docBodyRows: Array<{
      nodeId: string;
      markdown: string;
      bodyFormat?: "html";
      nodeType?: "html" | "whiteboard" | "workflow";
    }> = [];

    let pendingRawBlob: { path: string; info: RawArchiveBlob } | undefined;
    const rawKeys = new Set<string>();
    await replay(async (entry) => {
      if (pendingRawBlob) {
        if (entry.path !== pendingRawBlob.path)
          throw new Error(`Expected raw blob entry ${pendingRawBlob.path}, got ${entry.path}`);
        const { info } = pendingRawBlob;
        await importRawArchiveBlob(
          entry.body,
          info,
          (rows) => client.dump.importTables({ sessionId, table: info.table, rows }),
          blobChunkProtocol,
        );
        pendingRawBlob = undefined;
        return;
      }
      const rawMetadata = /^blobs\/(attachments|asset-texts)\/([a-f0-9]{64})\.json$/.exec(
        entry.path,
      );
      if (rawMetadata) {
        const info = await readRawBlobMetadata(entry.body, rawMetadata[1], rawMetadata[2]);
        const identity = `${info.table}:${info.key}`;
        if (rawKeys.has(identity)) throw new Error(`Duplicate raw blob metadata for ${info.key}`);
        rawKeys.add(identity);
        pendingRawBlob = { path: `${entry.path.slice(0, -5)}.bin`, info };
        return;
      }
      if (entry.path.startsWith("blobs/"))
        throw new Error(`Unexpected raw blob entry ${entry.path} without matching metadata`);
      if (entry.path === ATTACHMENT_BLOBS_ENTRY) {
        const n = await streamNdjsonRows(entry.body, (rows) =>
          sendRestoreBlobRows(
            rows,
            (parts) =>
              client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: parts }),
            blobChunkProtocol,
          ),
        );
        log(`imported ${n} attachment blobs`);
        return;
      }
      if (entry.path === ASSET_TEXT_BLOBS_ENTRY) {
        const n = await streamNdjsonRows(entry.body, (rows) =>
          sendRestoreBlobRows(
            rows,
            (parts) =>
              client.dump.importTables({ sessionId, table: "assetTextBlobs", rows: parts }),
            blobChunkProtocol,
          ),
        );
        log(`imported ${n} asset-text blobs`);
        return;
      }
      if (entry.path.startsWith(TABLE_ENTRY_PREFIX) && entry.path.endsWith(TABLE_ENTRY_SUFFIX)) {
        const table = entry.path.slice(
          TABLE_ENTRY_PREFIX.length,
          -TABLE_ENTRY_SUFFIX.length,
        ) as DumpTable;
        if (!IMPORT_ORDER.includes(table))
          throw new Error(
            `Unsupported archive table ${table}. Update busabase-cli before restoring; this version cannot restore the archive completely.`,
          );
        const importRows = table === "nodes" ? importNodeRows : streamNdjsonRows;
        const n = await importRows(entry.body, (rows) =>
          client.dump.importTables({ sessionId, table, ...sqlRows(rows) }),
        );
        log(`imported ${table}: ${n} rows`);
        return;
      }
      const documentBody = /^docs\/([^/]+)\.(md|html)$/.exec(entry.path);
      if (documentBody) {
        const nodeId = documentBody[1];
        const markdown = await readEntryText(entry.body);
        docBodyRows.push(
          documentBody[2] === "html"
            ? { nodeId, markdown, bodyFormat: "html" }
            : { nodeId, markdown },
        );
        return;
      }
      const richBody = /^rich\/([^/]+)\.(html|whiteboard\.json|workflow\.json)$/.exec(entry.path);
      if (richBody) {
        const nodeType =
          richBody[2] === "html"
            ? "html"
            : richBody[2] === "whiteboard.json"
              ? "whiteboard"
              : "workflow";
        docBodyRows.push({
          nodeId: richBody[1],
          markdown: await readEntryText(entry.body),
          nodeType,
        });
        return;
      }
      if (entry.path === "manifest.json") {
        const manifest = ManifestSchema.parse(JSON.parse(await readEntryText(entry.body)));
        assertSupportedRestoreTables(manifest.tables);
        if (manifest.fidelity !== "full")
          throw new Error("Cannot apply a non-full archive with the full restore importer");
        return;
      }
      throw new Error(
        `Unrecognized archive entry ${entry.path}. Update busabase-cli before restoring; skipping it could lose data.`,
      );
    });

    if (pendingRawBlob) throw new Error(`Archive ended before raw blob ${pendingRawBlob.path}`);

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
    if (!result.ok)
      throw new Error(
        `Full restore did not pass the target integrity checks: ${result.warnings.join("; ") || "commit was refused"}`,
      );
    return result;
  } catch (error) {
    // Rolling back a RESUMED restore would delete the progress this run just
    // recovered while leaving whatever the killed run had already landed —
    // moving the restore backwards. Leave it where it is so another
    // `--resume` can carry on from here.
    if (!resume) await client.dump.importAbort({ sessionId }).catch(() => undefined);
    throw error;
  }
}
