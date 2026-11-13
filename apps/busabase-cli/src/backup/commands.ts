/**
 * `backup` and `restore` — the terminal-facing halves of the full-fidelity
 * `.bbdump` archive format. Thin orchestration: drain every dump-eligible table
 * into an archive, or verify an archive and replay it into an empty space.
 */
import { access } from "node:fs/promises";
import type { BusabaseClient } from "busabase-sdk";
import {
  exportFull,
  SourceDeletedAfterSnapshotError,
  SPOOL_SUFFIXES,
} from "./export/full-exporter.js";
import { openVerifiedArchive } from "./format/archive-reader.js";
import { assertSupportedRestoreTables, importFull } from "./import/full-importer.js";

/** Progress is diagnostics, not data — it must never pollute `--output json` on stdout. */
const reportProgress = (message: string): void => {
  console.error(message);
};

/** Which of this archive's spool files a previous, interrupted run left behind. */
const findSpoolFiles = async (outFile: string): Promise<string[]> => {
  const present: string[] = [];
  for (const suffix of SPOOL_SUFFIXES) {
    try {
      await access(`${outFile}${suffix}`);
      present.push(`${outFile}${suffix}`);
    } catch {
      // absent — nothing to resume from for this one
    }
  }
  return present;
};

/**
 * Deliberately not implemented: `export` already writes the portable current-state
 * representation as a readable, diffable directory. The two formats stay separate
 * because a backup carries audit events, comments, reviews and ACLs that a package
 * must never leak.
 */
const STATE_ONLY_BACKUP_MESSAGE = [
  "--state-only backup is not implemented, and will not be — it is superseded by",
  "`busabase-cli export`, which writes the same state-level content as a readable,",
  "diffable directory you can push to GitHub:",
  "",
  "  busabase-cli export <node-slug> -o ./my-package",
  "  busabase-cli install https://github.com/<you>/<repo>",
  "",
  "`busabase-cli backup` stays the full-fidelity backup path (raw rows, original ids,",
  "history) — run it without --state-only. The two formats are deliberately separate:",
  "a backup carries the audit events, comments, reviews and ACLs that an exported",
  "package must never leak.",
].join("\n");

/** The restore-side mirror of {@link STATE_ONLY_BACKUP_MESSAGE}. */
const STATE_ONLY_RESTORE_MESSAGE = [
  "state-only archive restore is not implemented, and will not be — it is superseded",
  "by `busabase-cli install`, which installs state-level content into an EXISTING",
  "space as change requests you review before they go live:",
  "",
  "  busabase-cli install https://github.com/<you>/<repo> --into-folder <name>",
  "",
  "`busabase-cli restore` stays the full-fidelity restore path (original ids and",
  "history, into an empty space).",
].join("\n");

/** Snapshot retakes after a file is deleted mid-backup, before giving up. */
const SOURCE_CHANGE_RETAKES = 3;

export interface BackupCommandOptions {
  outFile: string;
  includeHistory: boolean;
  resume?: boolean;
  stateOnly?: boolean;
  json: boolean;
  /** Host to resolve a local server's root-relative asset urls against — see FullExportOptions.sourceHost. */
  baseUrl: string;
  spaceId?: string;
  /** `--retries`, honoured by the export's own retry loops — see FullExportOptions.retries. */
  retries?: number;
  toolVersion: string;
}

export const runBackup = async (
  client: BusabaseClient,
  options: BackupCommandOptions,
): Promise<unknown> => {
  if (options.stateOnly) throw new Error(STATE_ONLY_BACKUP_MESSAGE);
  const { spaceId } = options;
  if (!spaceId) {
    throw new Error(
      "No space configured. Pass --space-id <id>, export BUSABASE_SPACE_ID, or run `busabase-cli login`.",
    );
  }

  // A killed backup leaves its downloaded blobs in `.part` files next to the
  // archive. Without `--resume` they would be silently overwritten and
  // re-downloaded — say so rather than quietly repeating ~2/3 of the run.
  if (!options.resume) {
    const orphaned = await findSpoolFiles(options.outFile);
    if (orphaned.length > 0) {
      reportProgress(
        `  NOTE: found ${orphaned.length} partial file(s) from an interrupted backup ` +
          `(${orphaned.join(", ")}). Re-run with --resume to continue from them; ` +
          "this run will start over and overwrite them.",
      );
    }
  }

  reportProgress(
    `Backing up space ${spaceId} → ${options.outFile} (full fidelity, history=${options.includeHistory}` +
      `${options.resume ? ", resuming" : ""})`,
  );
  // A live workspace can delete a file while its bytes are still downloading.
  // Retake the snapshot (which no longer has that row) and keep every verified
  // download; each round only fetches what is new, so the window shrinks.
  let resume = Boolean(options.resume);
  let manifest: Awaited<ReturnType<typeof exportFull>>;
  for (let round = 1; ; round++) {
    try {
      manifest = await exportFull({
        client,
        outPath: options.outFile,
        spaceId,
        sourceHost: options.baseUrl,
        includeHistory: options.includeHistory,
        toolVersion: options.toolVersion,
        resume,
        retries: options.retries,
        onProgress: (message) => reportProgress(`  ${message}`),
      });
      break;
    } catch (error) {
      if (!(error instanceof SourceDeletedAfterSnapshotError) || round > SOURCE_CHANGE_RETAKES)
        throw error;
      reportProgress(
        `  ${error.message.replace(/ No new archive was published\.$/, "")} ` +
          `Taking a new snapshot and keeping verified downloads (${round}/${SOURCE_CHANGE_RETAKES}).`,
      );
      resume = true;
    }
  }

  const rows = Object.values(manifest.tables).reduce((total, count) => total + count, 0);
  if (options.json) {
    return {
      file: options.outFile,
      rows,
      blobCount: manifest.blobCount,
      blobBytes: manifest.blobBytes,
      manifest,
    };
  }
  return [
    `Done. ${rows} rows, ${manifest.blobCount} blobs (${manifest.blobBytes} bytes) → ${options.outFile}`,
    "",
    "Restore it into an empty space with:",
    `  busabase-cli restore ${options.outFile}`,
  ].join("\n");
};

export interface RestoreCommandOptions {
  file: string;
  resume?: boolean;
  intoFolder?: string;
  /** Verify and describe the archive without sending any restore requests. */
  dryRun?: boolean;
  json: boolean;
}

export const runRestore = async (
  client: BusabaseClient,
  options: RestoreCommandOptions,
): Promise<unknown> => {
  reportProgress(`Reading ${options.file} …`);
  // Streams the whole archive once, hashing incrementally (never buffering a
  // whole entry — see archive-reader.ts), and verifies every entry against
  // the manifest before a single row is replayed.
  const archive = await openVerifiedArchive(options.file);
  try {
    const manifest = archive.manifest;
    reportProgress(
      `Archive: fidelity=${manifest.fidelity} space=${manifest.spaceId} exportedAt=${manifest.exportedAt}`,
    );
    if (manifest.fidelity !== "full") throw new Error(STATE_ONLY_RESTORE_MESSAGE);
    assertSupportedRestoreTables(manifest.tables);
    if (manifest.sqlCapture?.mode === "legacy-paginated")
      reportProgress(
        "WARNING: this archive used legacy SQL pagination, which cannot guarantee a consistent view during concurrent changes.",
      );
    if (manifest.attachmentMaterializations?.length)
      reportProgress(
        `Archive includes ${manifest.attachmentMaterializations.length} readable attachment dependencies restored as owned public-file projections; original foreign ownership/metadata is intentionally absent.`,
      );

    if (options.intoFolder) {
      throw new Error("--into-folder only applies to state-only archives.");
    }

    if (options.dryRun) {
      const rows = Object.values(manifest.tables).reduce((total, count) => total + count, 0);
      if (options.json) {
        return {
          dryRun: true,
          restored: false,
          file: options.file,
          sourceSpaceId: manifest.spaceId,
          checksumVerified: true,
          rows,
          tables: manifest.tables,
          blobCount: manifest.blobCount,
          textBlobCount: manifest.textBlobCount,
          resume: Boolean(options.resume),
          targetChecked: false,
        };
      }
      return [
        `Archive verified: ${rows} rows, ${manifest.blobCount} attachment blobs, ${manifest.textBlobCount} text blobs.`,
        "Dry run: no restore requests were sent. Target availability and emptiness were not checked.",
      ].join("\n");
    }

    if (options.resume) {
      reportProgress(
        "Resuming: every existing SQL row is validated before stored objects are written. " +
          "Mismatched data or a different archive is refused; this run will not roll back earlier progress.",
      );
    }

    const result = await importFull({
      client,
      archivePath: options.file,
      streamEntries: archive.streamEntries,
      manifest,
      sourceSpaceId: manifest.spaceId,
      resume: Boolean(options.resume),
      onProgress: (message) => reportProgress(`  ${message}`),
    });

    if (options.json) {
      return {
        restored: result.ok,
        file: options.file,
        spaceId: manifest.spaceId,
        warnings: result.warnings,
        notices: result.notices ?? [],
      };
    }
    if (!result.ok || result.warnings.length > 0) {
      return [
        "Restore completed with warnings:",
        ...result.warnings.map((warning) => `  • ${warning}`),
      ].join("\n");
    }
    return [
      "Restore completed successfully.",
      ...(result.notices ?? []).map((notice) => `  • ${notice}`),
    ].join("\n");
  } finally {
    await archive.cleanup();
  }
};
