/**
 * Pure, streaming text-statistics scanner shared by `putText` (single
 * mandatory pass over agent-supplied text) and the lazy checkpoint computation
 * in `readLines` (same pass, run once against an already-stored object). No
 * `server-only` / db / storage imports — feed it Buffer chunks in stream order,
 * unit-testable in isolation.
 *
 * Computes, in ONE pass, O(1) memory (bounded by chunk size, not file size):
 *  - the SHA-256 content hash (storage addressing + local-cache key)
 *  - UTF-8 well-formedness (see `./utf8-scan`)
 *  - line / char / byte counts
 *  - adaptive `(line, byteOffset)` checkpoints for `readLines`
 */
import { createHash, type Hash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { StreamingUtf8Validator } from "./utf8-scan";

export interface TextScanCheckpoint {
  line: number;
  byteOffset: number;
}

export interface TextScanResult {
  /** UTF-8 well-formed across the whole stream (chunk-boundary-safe). */
  valid: boolean;
  /** `sha256:<hex>` — same format as `attachments.contentHash` (`hashBuffer`). */
  sha256: string;
  byteCount: number;
  /** Total lines, counting a final line with no trailing `\n` as one line. */
  lineCount: number;
  charCount: number;
  checkpoints: TextScanCheckpoint[];
}

/** Emit a checkpoint every 1000 lines... */
export const CHECKPOINT_LINE_INTERVAL = 1000;
/** ...or every 4 MB since the last checkpoint, whichever comes first. */
export const CHECKPOINT_BYTE_INTERVAL = 4 * 1024 * 1024;

const NEWLINE = 0x0a;

/**
 * Streaming scanner. Checkpoints are only ever recorded at a `\n` boundary —
 * so every `byteOffset` is provably the exact first byte of `line` — never
 * mid-line. The tradeoff: one pathologically long single line (no `\n` for
 * many MB) can make ONE checkpoint interval exceed 4 MB, since the byte
 * trigger is only evaluated where it's safe to record (a line boundary). This
 * is accepted, not a bug: the grep scanner's long-line guard and `readLines`'
 * ~2 MB response cap independently bound the cost of that scenario (see the
 * spec's "Huge single-line file" failure-scenario row) without requiring
 * checkpoints to be able to lie about where a line actually starts.
 */
export class TextStreamScanner {
  private hash: Hash = createHash("sha256");
  private utf8 = new StreamingUtf8Validator();
  private decoder = new StringDecoder("utf8");
  private byteCount = 0;
  private lineCount = 0;
  private charCount = 0;
  private checkpoints: TextScanCheckpoint[] = [];
  private bytesSinceCheckpoint = 0;
  private linesSinceCheckpoint = 0;
  /** Bytes written since the last `\n` (or start) — is there a trailing partial line? */
  private bytesSinceNewline = 0;

  /** Feed the next chunk, in stream order. */
  write(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.hash.update(chunk);
    this.utf8.push(chunk);
    // Incremental decode via StringDecoder correctly buffers a multi-byte
    // sequence split across chunk boundaries; codepoint count via spread
    // (handles surrogate pairs for astral characters correctly).
    this.charCount += [...this.decoder.write(chunk)].length;

    for (let i = 0; i < chunk.length; i++) {
      this.byteCount++;
      this.bytesSinceCheckpoint++;
      if (chunk[i] === NEWLINE) {
        this.lineCount++;
        this.linesSinceCheckpoint++;
        this.bytesSinceNewline = 0;
        if (
          this.linesSinceCheckpoint >= CHECKPOINT_LINE_INTERVAL ||
          this.bytesSinceCheckpoint >= CHECKPOINT_BYTE_INTERVAL
        ) {
          // byteOffset = the byte right after this `\n` = the exact start of
          // the next line (`lineCount + 1`).
          this.checkpoints.push({ line: this.lineCount + 1, byteOffset: this.byteCount });
          this.linesSinceCheckpoint = 0;
          this.bytesSinceCheckpoint = 0;
        }
      } else {
        this.bytesSinceNewline++;
      }
    }
  }

  /** Call once after the last chunk. */
  finish(): TextScanResult {
    this.charCount += [...this.decoder.end()].length;
    const trailingPartialLine = this.bytesSinceNewline > 0;
    return {
      valid: this.utf8.finish(),
      sha256: `sha256:${this.hash.digest("hex")}`,
      byteCount: this.byteCount,
      lineCount: this.lineCount + (trailingPartialLine ? 1 : 0),
      charCount: this.charCount,
      checkpoints: this.checkpoints,
    };
  }
}

/** Whole-buffer convenience wrapper (inline `putText` path, ≤ 1 MB). */
export const scanTextBuffer = (buffer: Buffer): TextScanResult => {
  const scanner = new TextStreamScanner();
  scanner.write(buffer);
  return scanner.finish();
};

/**
 * Resolve the nearest checkpoint at or before `targetLine` (falls back to the
 * implicit base checkpoint `{ line: 1, byteOffset: 0 }`, always valid since
 * every file's first line starts at byte 0). Checkpoints are stored in
 * ascending `line` order by construction (append-only during the scan).
 */
export const nearestCheckpointAtOrBefore = (
  checkpoints: TextScanCheckpoint[],
  targetLine: number,
): TextScanCheckpoint => {
  let best: TextScanCheckpoint = { line: 1, byteOffset: 0 };
  for (const checkpoint of checkpoints) {
    if (checkpoint.line <= targetLine && checkpoint.line > best.line) {
      best = checkpoint;
    }
    if (checkpoint.line > targetLine) break;
  }
  return best;
};
