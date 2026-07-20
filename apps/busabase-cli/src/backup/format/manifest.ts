import { z } from "zod";

export const FORMAT_VERSION = 1;

/**
 * `.bbdump` manifest — the archive's own table of contents + integrity
 * record. Written last (after every entry's bytes/checksums are known) so it
 * can summarize the whole archive. `checksum` is the top-level integrity
 * guard: sha256 of the newline-joined, sorted `"<entryPath>:<entrySha256>"`
 * strings for every OTHER entry in the archive (manifest.json excluded from
 * its own hash, obviously). `readArchive` recomputes this the same way and
 * refuses to import on mismatch — catches a truncated/corrupted/tampered
 * file before any row hits the target space.
 */
export const ManifestSchema = z.object({
  formatVersion: z.literal(FORMAT_VERSION),
  toolVersion: z.string(),
  exportedAt: z.string(),
  spaceId: z.string(),
  sourceHost: z.string(),
  fidelity: z.enum(["full", "state"]),
  /** Vault items and webhook signing secrets are never written to the archive. */
  excludesSecrets: z.literal(true),
  tables: z.record(z.string(), z.number().int().nonnegative()),
  blobCount: z.number().int().nonnegative(),
  blobBytes: z.number().int().nonnegative(),
  /**
   * Extracted-text ("Drive Grep Retrieval") blobs, counted separately from the
   * attachment blobs above because they are a different object class — derived
   * text, content-addressed under `asset-texts/blobs/sha256/…`, one per
   * `busabase_asset_texts` row that owns its own object.
   *
   * `.default(0)` rather than required: archives written before asset-text
   * blobs were captured at all carry no such field, and those are exactly the
   * archives an operator most needs to be able to still open — the import's
   * integrity pass is what tells them the text is missing, which it can only
   * do if the manifest parses in the first place.
   */
  textBlobCount: z.number().int().nonnegative().optional().default(0),
  textBlobBytes: z.number().int().nonnegative().optional().default(0),
  /** sha256 hex digest — see the doc comment above for exactly what it covers. */
  checksum: z.string(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export interface EntryChecksum {
  path: string;
  sha256: string;
}

/**
 * The exact canonicalization `computeManifestChecksum` hashes: entries sorted
 * by path (archive/tar entry order is not guaranteed stable across platforms),
 * one `"path:sha256"` line per entry, `\n`-joined, sha256 over the resulting
 * UTF-8 bytes. Exported so `archive-reader.ts` can recompute it identically.
 */
export function canonicalizeEntryChecksums(entries: EntryChecksum[]): string {
  return entries
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((e) => `${e.path}:${e.sha256}`)
    .join("\n");
}
