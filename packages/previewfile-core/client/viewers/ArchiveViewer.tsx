/// <reference path="../../types/ambient.d.ts" />
"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { explainError } from "./explain-error";
import { LoadingState } from "./LoadingState";

/** Unified entry interface for all archive formats */
interface ArchiveEntry {
  filename: string;
  directory?: boolean;
  uncompressedSize?: number;
}

interface ArchiveViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
}

function formatEntrySize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}

/** Supported archive extensions categorized by library */
const ZIP_EXTENSIONS = ["zip", "jar"];
const LIBARCHIVE_EXTENSIONS = ["rar", "7z", "tar", "gz", "bz2", "xz", "tgz"];

function getArchiveType(fileName: string): "zip" | "libarchive" | null {
  const lowerName = fileName.toLowerCase();

  // Handle compound extensions like .tar.gz
  if (lowerName.endsWith(".tar.gz") || lowerName.endsWith(".tgz")) return "libarchive";
  if (lowerName.endsWith(".tar.bz2")) return "libarchive";
  if (lowerName.endsWith(".tar.xz")) return "libarchive";

  const ext = lowerName.split(".").pop();
  if (!ext) return null;

  if (ZIP_EXTENSIONS.includes(ext)) return "zip";
  if (LIBARCHIVE_EXTENSIONS.includes(ext)) return "libarchive";

  return null;
}

/**
 * Entries from libarchive.js `getFilesArray()`. Each item is a file with the
 * path of its *folder* (`"brief/"`, `""` at the root); the name is on the file
 * itself. A key with no extracted data arrives as the bare name string.
 */
export function libarchiveEntries(
  files: { file: { name: string; size: number } | string; path: string }[],
): ArchiveEntry[] {
  return files.map(({ file, path }) => ({
    filename: `${path}${typeof file === "string" ? file : file.name}`,
    directory: false,
    uncompressedSize: typeof file === "string" ? undefined : file.size,
  }));
}

/**
 * Adds a folder row before the first entry of every folder the archive does
 * not list itself — libarchive.js never returns folders, and many zips carry
 * only file entries — so nested files never appear under no folder at all.
 * Keeps the archive's own order.
 */
export function withImpliedFolders(entries: ArchiveEntry[]): ArchiveEntry[] {
  const folders = new Set(
    entries.filter((e) => e.directory).map((e) => e.filename.replace(/\/$/, "")),
  );
  const result: ArchiveEntry[] = [];
  for (const entry of entries) {
    const parts = entry.filename.replace(/\/$/, "").split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      if (folders.has(folder)) continue;
      folders.add(folder);
      result.push({ filename: `${folder}/`, directory: true });
    }
    result.push(entry);
  }
  return result;
}

/** Filters out macOS metadata files from entries */
function filterMacOSMetadata(entries: ArchiveEntry[]): ArchiveEntry[] {
  return entries.filter((e) => {
    const name = e.filename;
    const baseName = name.split("/").pop() || "";

    // Skip __MACOSX folder and its contents
    if (name.startsWith("__MACOSX/") || name === "__MACOSX") return false;

    // Skip AppleDouble files (._filename)
    if (baseName.startsWith("._")) return false;

    // Skip .DS_Store files
    if (baseName === ".DS_Store") return false;

    return true;
  });
}

/**
 * Archive Viewer Component
 * Lists contents of archive files:
 * - ZIP files using @zip.js/zip.js
 * - RAR, 7z, tar, gz, bz2, xz files using libarchive.js (WebAssembly)
 */
export default function ArchiveViewer({
  fileUrl,
  fileName,
  watermark: _watermark,
  noDownload: _noDownload,
}: ArchiveViewerProps) {
  const { LL } = useI18n();
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const archiveType = getArchiveType(fileName);

  useEffect(() => {
    if (!archiveType) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadArchive = async () => {
      try {
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const blob = await res.blob();

        if (cancelled) return;

        let rawEntries: ArchiveEntry[] = [];

        if (archiveType === "zip") {
          // Use zip.js for ZIP files
          const zip = await import("@zip.js/zip.js");
          const blobReader = new zip.BlobReader(blob);
          const zipReader = new zip.ZipReader(blobReader);

          const zipEntries = await zipReader.getEntries();
          await zipReader.close();

          rawEntries = zipEntries.map((e) => ({
            filename: e.filename,
            directory: e.directory,
            uncompressedSize: e.uncompressedSize,
          }));
        } else {
          // Use libarchive.js for RAR, 7z, tar, gz, etc.
          const { Archive } = await import("libarchive.js");

          // Initialize with worker URL
          Archive.init({
            workerUrl: "/libarchive/worker-bundle.js",
          });

          // Create a File object from the blob
          const file = new File([blob], fileName, { type: blob.type });
          const archive = await Archive.open(file);
          rawEntries = libarchiveEntries(await archive.getFilesArray());
        }

        if (cancelled) return;

        setEntries(withImpliedFolders(filterMacOSMetadata(rawEntries)));
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.error("Archive loading error:", err);
          setError(err instanceof Error ? err.message : "Failed to read archive");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadArchive();
    return () => {
      cancelled = true;
    };
  }, [fileUrl, archiveType, fileName]);

  if (!archiveType) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6">
        <h3 className="text-lg font-semibold">{LL.preview.archivePreviewTitle()}</h3>
        <p className="text-sm text-muted-foreground mt-1">{fileName}</p>
        <p className="text-sm text-yellow-600 mt-2">{LL.preview.archiveViewerComingSoon()}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center">
        <LoadingState message={LL.preview.loading()} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6">
        <h3 className="text-lg font-semibold">{LL.preview.archivePreviewTitle()}</h3>
        <p className="text-sm text-muted-foreground mt-1">{fileName}</p>
        <p className="text-sm text-destructive mt-2">{explainError(LL.preview, error)}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col p-6 overflow-hidden">
      <h3 className="text-lg font-semibold mb-4 shrink-0">{LL.preview.archiveContentsTitle()}</h3>
      <ul className="flex-1 min-h-0 overflow-y-auto list-none p-0 m-0 space-y-0.5 text-sm border rounded-lg bg-muted/20">
        {entries.length === 0 ? (
          <li className="text-muted-foreground py-4 px-4">{LL.preview.archiveNoEntries()}</li>
        ) : (
          entries.map((entry, i) => {
            const name = entry.filename.replace(/\/$/, "") || entry.filename;
            // Nesting of the entry itself: a folder's trailing slash is not a level.
            const depth = name.match(/\//g)?.length ?? 0;
            const sizeStr =
              entry.directory || entry.uncompressedSize == null
                ? ""
                : ` · ${formatEntrySize(entry.uncompressedSize)}`;
            return (
              <li
                key={`${entry.filename}-${i}`}
                className="flex items-center gap-2 py-1.5 px-3 hover:bg-muted/50"
                style={{ paddingLeft: `${12 + depth * 16}px` }}
              >
                <span className="text-muted-foreground shrink-0">
                  {entry.directory ? "📁" : "📄"}
                </span>
                <span className="truncate min-w-0" title={entry.filename}>
                  {name.split("/").pop() || name}
                </span>
                {sizeStr && (
                  <span className="text-muted-foreground text-xs shrink-0">{sizeStr}</span>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
