/**
 * `backup` and `restore` — the terminal-facing halves of the full-fidelity
 * `.bbdump` archive format. Thin orchestration: drain every dump-eligible table
 * into an archive, or verify an archive and replay it into an empty space.
 */
import type { BusabaseClient } from "busabase-sdk";
import { exportFull } from "./export/full-exporter.js";
import { readArchive } from "./format/archive-reader.js";
import { importFull } from "./import/full-importer.js";

/** Progress is diagnostics, not data — it must never pollute `--output json` on stdout. */
const reportProgress = (message: string): void => {
  console.error(message);
};

/**
 * Deliberately not implemented: a state-level export is a *published package*,
 * which `publish` already writes as a readable, diffable directory. The two
 * formats stay separate because a backup carries audit events, comments,
 * reviews and ACLs that a package must never leak.
 */
const STATE_ONLY_BACKUP_MESSAGE = [
  "--state-only backup is not implemented, and will not be — it is superseded by",
  "`busabase-cli publish`, which writes the same state-level content as a readable,",
  "diffable directory you can push to GitHub:",
  "",
  "  busabase-cli publish <node-slug> -o ./my-package",
  "  busabase-cli install https://github.com/<you>/<repo>",
  "",
  "`busabase-cli backup` stays the full-fidelity backup path (raw rows, original ids,",
  "history) — run it without --state-only. The two formats are deliberately separate:",
  "a backup carries the audit events, comments, reviews and ACLs that a published",
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

export interface BackupCommandOptions {
  outFile: string;
  includeHistory: boolean;
  stateOnly?: boolean;
  json: boolean;
  /** Host to resolve a local server's root-relative asset urls against — see FullExportOptions.sourceHost. */
  baseUrl: string;
  spaceId?: string;
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

  reportProgress(
    `Backing up space ${spaceId} → ${options.outFile} (full fidelity, history=${options.includeHistory})`,
  );
  const manifest = await exportFull({
    client,
    outPath: options.outFile,
    spaceId,
    sourceHost: options.baseUrl,
    includeHistory: options.includeHistory,
    toolVersion: options.toolVersion,
    onProgress: (message) => reportProgress(`  ${message}`),
  });

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
  json: boolean;
}

export const runRestore = async (
  client: BusabaseClient,
  options: RestoreCommandOptions,
): Promise<unknown> => {
  if (options.resume) {
    throw new Error("--resume is not implemented yet in this version.");
  }

  reportProgress(`Reading ${options.file} …`);
  // Integrity-verifies the whole archive before a single row is replayed.
  const archive = await readArchive(options.file);
  reportProgress(
    `Archive: fidelity=${archive.manifest.fidelity} space=${archive.manifest.spaceId} exportedAt=${archive.manifest.exportedAt}`,
  );
  if (archive.manifest.fidelity !== "full") throw new Error(STATE_ONLY_RESTORE_MESSAGE);
  if (options.intoFolder) {
    throw new Error("--into-folder only applies to state-only archives.");
  }

  const result = await importFull({
    client,
    archive,
    onProgress: (message) => reportProgress(`  ${message}`),
  });

  if (options.json) {
    return {
      restored: result.ok,
      file: options.file,
      spaceId: archive.manifest.spaceId,
      warnings: result.warnings,
    };
  }
  if (!result.ok || result.warnings.length > 0) {
    return [
      "Restore completed with warnings:",
      ...result.warnings.map((warning) => `  • ${warning}`),
    ].join("\n");
  }
  return "Restore completed successfully.";
};
