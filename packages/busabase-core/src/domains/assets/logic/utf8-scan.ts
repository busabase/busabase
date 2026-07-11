/**
 * Pure, streaming-safe UTF-8 well-formedness check (Unicode Table 3-7 "Well-Formed
 * UTF-8 Byte Sequences"). No `server-only` / db / storage imports — safe to unit
 * test in isolation and to run against arbitrary chunk boundaries (including ones
 * that split a multi-byte sequence), which is exactly what `putText`'s single
 * streaming pass needs: reject invalid UTF-8 without ever buffering the whole
 * object in memory.
 *
 * `Buffer#toString("utf8")` is NOT a validity check — it silently replaces
 * invalid bytes with U+FFFD instead of surfacing an error, so it can't be used
 * to reject bad input. This class is the real check.
 */
export class StreamingUtf8Validator {
  // Bytes still expected to complete the multi-byte sequence in progress.
  private lead = 0;
  // Valid [lo, hi] range for the NEXT continuation byte. Narrower than the
  // generic 0x80-0xBF for the FIRST continuation byte of some leading bytes,
  // to reject overlong encodings and encoded surrogates (0xD800-0xDFFF).
  private lo = 0x80;
  private hi = 0xbf;
  private ok = true;

  /** Feed the next chunk, in stream order. Returns false as soon as invalid. */
  push(chunk: Buffer): boolean {
    if (!this.ok) return false;
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      if (this.lead === 0) {
        if (byte <= 0x7f) {
          continue; // ASCII
        }
        if (byte >= 0xc2 && byte <= 0xdf) {
          this.lead = 1;
          this.lo = 0x80;
          this.hi = 0xbf;
        } else if (byte === 0xe0) {
          this.lead = 2;
          this.lo = 0xa0; // excludes overlong 3-byte encodings
          this.hi = 0xbf;
        } else if (byte >= 0xe1 && byte <= 0xec) {
          this.lead = 2;
          this.lo = 0x80;
          this.hi = 0xbf;
        } else if (byte === 0xed) {
          this.lead = 2;
          this.lo = 0x80;
          this.hi = 0x9f; // excludes encoded surrogates D800-DFFF
        } else if (byte >= 0xee && byte <= 0xef) {
          this.lead = 2;
          this.lo = 0x80;
          this.hi = 0xbf;
        } else if (byte === 0xf0) {
          this.lead = 3;
          this.lo = 0x90; // excludes overlong 4-byte encodings
          this.hi = 0xbf;
        } else if (byte >= 0xf1 && byte <= 0xf3) {
          this.lead = 3;
          this.lo = 0x80;
          this.hi = 0xbf;
        } else if (byte === 0xf4) {
          this.lead = 3;
          this.lo = 0x80;
          this.hi = 0x8f; // excludes code points beyond U+10FFFF
        } else {
          // 0x80-0xC1 (stray continuation / overlong 2-byte lead), 0xF5-0xFF.
          this.ok = false;
          return false;
        }
        continue;
      }

      if (byte < this.lo || byte > this.hi) {
        this.ok = false;
        return false;
      }
      this.lead--;
      // Only the FIRST continuation byte of a sequence has a narrowed range;
      // any further ones are the generic 0x80-0xBF.
      this.lo = 0x80;
      this.hi = 0xbf;
    }
    return true;
  }

  /** Call once after the last chunk. False if a sequence was left incomplete (truncated at EOF). */
  finish(): boolean {
    return this.ok && this.lead === 0;
  }

  get valid(): boolean {
    return this.ok;
  }
}
