import { createReadStream } from "node:fs";
import { type FileHandle, mkdtemp, open, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ArchiveWriter } from "../format/archive-writer.js";

type Row = Record<string, unknown>;
const WRITE_BUFFER_BYTES = 256 * 1024;

/** Write small chunks, awaiting disk backpressure without retaining the table. */
async function writeLines(handle: FileHandle, lines: Iterable<string> | AsyncIterable<string>) {
  let buffered: string[] = [];
  let bytes = 0;
  for await (const line of lines) {
    buffered.push(line);
    bytes += Buffer.byteLength(line, "utf8");
    if (bytes < WRITE_BUFFER_BYTES) continue;
    await handle.writeFile(buffered.join(""));
    buffered = [];
    bytes = 0;
  }
  if (buffered.length > 0) await handle.writeFile(buffered.join(""));
}

/** Decode through the stream's StringDecoder so split CJK sequences survive. */
async function* readLines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { encoding: "utf8" });
  let segments: string[] = [];
  try {
    for await (const chunk of stream) {
      const text = chunk as string;
      let start = 0;
      let newline: number;
      // Search the new chunk only, avoiding quadratic scans of large cells.
      // biome-ignore lint/suspicious/noAssignInExpressions: incremental NDJSON parser
      while ((newline = text.indexOf("\n", start)) !== -1) {
        segments.push(text.slice(start, newline));
        const line = segments.join("");
        segments = [];
        if (line) yield line;
        start = newline + 1;
      }
      if (start < text.length) segments.push(text.slice(start));
    }
    if (segments.length > 0) yield segments.join("");
  } finally {
    stream.destroy();
  }
}

/**
 * A transient table snapshot. Table data is always fetched anew, including on
 * --resume; only content-addressed blob downloads are resumable. No caller may
 * use this for a table whose ids are needed by another exported table.
 */
export class SpooledTable {
  private raw: FileHandle | undefined;
  private filtered = false;
  private activePath: string;
  private readonly rawPath: string;
  private readonly filteredPath: string;

  private constructor(
    private readonly directory: string,
    handle: FileHandle,
    private readonly table: string,
  ) {
    this.raw = handle;
    this.rawPath = join(directory, "raw.ndjson");
    this.activePath = this.rawPath;
    this.filteredPath = join(directory, "filtered.ndjson");
  }

  static async create(archivePath: string, table = "fieldValues"): Promise<SpooledTable> {
    const directory = await mkdtemp(
      join(dirname(archivePath), `.${basename(archivePath)}.tables-`),
    );
    try {
      return new SpooledTable(directory, await open(join(directory, "raw.ndjson"), "wx"), table);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async append(rows: readonly Row[]): Promise<void> {
    if (!this.raw) throw new Error("Cannot append to a closed table spool.");
    const table = this.table;
    const lines = function* () {
      for (const row of rows) {
        if (row === null || typeof row !== "object" || Array.isArray(row)) {
          throw new Error(`Cannot back up ${table}: the server returned a non-object row.`);
        }
        yield `${JSON.stringify(row)}\n`;
      }
    };
    await writeLines(this.raw, lines());
  }

  private async closeRaw(): Promise<void> {
    const handle = this.raw;
    this.raw = undefined;
    if (handle) await handle.close();
  }

  /** Validate and filter one row at a time after every parent table was fetched. */
  async filter(keep: (row: Row) => boolean): Promise<number> {
    return this.transform((row) => (keep(row) ? row : undefined));
  }

  /** Rewrite a bounded pass, including no-history's nullable-reference changes. */
  async transform(choose: (row: Row) => Row | undefined): Promise<number> {
    await this.closeRaw();
    const input = this.activePath;
    const outputPath = input === this.rawPath ? this.filteredPath : this.rawPath;
    const output = await open(outputPath, "w");
    let kept = 0;
    const table = this.table;
    const lines = async function* () {
      let number = 0;
      for await (const line of readLines(input)) {
        number += 1;
        let row: unknown;
        try {
          row = JSON.parse(line);
        } catch {
          throw new Error(`Cannot back up ${table}: invalid JSON in table spool row ${number}.`);
        }
        if (row === null || typeof row !== "object" || Array.isArray(row)) {
          throw new Error(`Cannot back up ${table}: non-object table spool row ${number}.`);
        }
        const chosen = choose(row as Row);
        if (!chosen) continue;
        kept += 1;
        yield `${JSON.stringify(chosen)}\n`;
      }
    };
    try {
      await writeLines(output, lines());
    } finally {
      await output.close();
    }
    this.filtered = true;
    this.activePath = outputPath;
    return kept;
  }

  /** Seal a table with no outgoing FK filter (e.g. commits in full-history mode). */
  async seal(): Promise<void> {
    await this.closeRaw();
    this.filtered = true;
  }

  async writeArchive(writer: Pick<ArchiveWriter, "addStream">, entryPath: string): Promise<void> {
    if (!this.filtered)
      throw new Error("Cannot archive a table before its references were checked.");
    const { size } = await stat(this.activePath);
    const source = createReadStream(this.activePath);
    try {
      await writer.addStream(entryPath, size, source);
    } finally {
      source.destroy();
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.closeRaw();
    } finally {
      await rm(this.directory, { recursive: true, force: true });
    }
  }
}
