import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_BYTE_INTERVAL,
  CHECKPOINT_LINE_INTERVAL,
  nearestCheckpointAtOrBefore,
  scanTextBuffer,
  TextStreamScanner,
} from "../src/domains/assets/logic/text-scan";
import { StreamingUtf8Validator } from "../src/domains/assets/logic/utf8-scan";

/** Whole-buffer convenience wrapper for these tests (production code only ever streams chunks). */
const isWellFormedUtf8 = (buffer: Buffer): boolean => {
  const validator = new StreamingUtf8Validator();
  return validator.push(buffer) && validator.finish();
};

const makeLines = (count: number, lineLength: number, char = "a"): string =>
  `${Array.from({ length: count }, () => char.repeat(lineLength)).join("\n")}\n`;

describe("TextStreamScanner — checkpoint math", () => {
  it("emits a checkpoint on the 1000-line trigger", () => {
    const text = makeLines(2500, 5); // short lines — far under the 4MB byte trigger
    const result = scanTextBuffer(Buffer.from(text, "utf8"));
    // checkpoints at line 1001 (after 1000 newlines) and line 2001 (after 2000 newlines)
    expect(result.checkpoints.map((c) => c.line)).toEqual([1001, 2001]);
    for (const checkpoint of result.checkpoints) {
      // byteOffset must be the exact start of `line` in the original text.
      const linesBefore = `${text
        .split("\n")
        .slice(0, checkpoint.line - 1)
        .join("\n")}\n`;
      expect(checkpoint.byteOffset).toBe(Buffer.byteLength(linesBefore, "utf8"));
    }
  });

  it("emits a checkpoint on the 4MB byte trigger before 1000 lines accumulate", () => {
    // ~8300 bytes/line * 505 lines > 4MB, well under 1000 lines.
    const lineLength = 8300;
    const text = makeLines(600, lineLength);
    const result = scanTextBuffer(Buffer.from(text, "utf8"));
    expect(result.checkpoints.length).toBeGreaterThan(0);
    const first = result.checkpoints[0];
    expect(first.line).toBeLessThan(CHECKPOINT_LINE_INTERVAL);
    // Each checkpoint's byteOffset since the previous one should be >= the byte interval
    // (it only fires once the threshold is crossed at a newline boundary).
    expect(first.byteOffset).toBeGreaterThanOrEqual(CHECKPOINT_BYTE_INTERVAL);
  });

  it("fires on whichever trigger comes first when both are close", () => {
    // Lines sized so the byte trigger (4MB) lands almost exactly at the 1000-line mark.
    const lineLength = Math.floor(CHECKPOINT_BYTE_INTERVAL / CHECKPOINT_LINE_INTERVAL); // ~4096
    const text = makeLines(1500, lineLength);
    const result = scanTextBuffer(Buffer.from(text, "utf8"));
    expect(result.checkpoints.length).toBeGreaterThanOrEqual(1);
    // First checkpoint should land at or very near line 1001 (both triggers converge there).
    expect(result.checkpoints[0].line).toBeLessThanOrEqual(1002);
  });

  it("counts a trailing line with no newline as a full line", () => {
    const result = scanTextBuffer(Buffer.from("a\nb\nc", "utf8"));
    expect(result.lineCount).toBe(3);
  });

  it("counts an exact-trailing-newline file without an extra phantom line", () => {
    const result = scanTextBuffer(Buffer.from("a\nb\nc\n", "utf8"));
    expect(result.lineCount).toBe(3);
  });

  it("handles a chunk boundary splitting a multi-byte UTF-8 sequence", () => {
    const text = "héllo wörld 你好世界\n";
    const bytes = Buffer.from(text, "utf8");
    // Split mid-way through a multi-byte sequence (byte 7 is inside "ö").
    const scanner = new TextStreamScanner();
    scanner.write(bytes.subarray(0, 7));
    scanner.write(bytes.subarray(7));
    const result = scanner.finish();
    expect(result.valid).toBe(true);
    expect(result.charCount).toBe([...text].length);
  });

  it("computes the sha256 content hash in the sha256:<hex> format", () => {
    const result = scanTextBuffer(Buffer.from("hello world", "utf8"));
    expect(result.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("nearestCheckpointAtOrBefore — boundary resolution", () => {
  const checkpoints = [
    { line: 1001, byteOffset: 5000 },
    { line: 2001, byteOffset: 10000 },
  ];

  it("returns the base checkpoint (line 1, byte 0) for line 0 or 1", () => {
    expect(nearestCheckpointAtOrBefore(checkpoints, 1)).toEqual({ line: 1, byteOffset: 0 });
  });

  it("returns the base checkpoint for any line before the first real checkpoint", () => {
    expect(nearestCheckpointAtOrBefore(checkpoints, 500)).toEqual({ line: 1, byteOffset: 0 });
  });

  it("returns the exact checkpoint when the target line matches one exactly", () => {
    expect(nearestCheckpointAtOrBefore(checkpoints, 1001)).toEqual({
      line: 1001,
      byteOffset: 5000,
    });
  });

  it("returns the nearest checkpoint at or before a line between two checkpoints", () => {
    expect(nearestCheckpointAtOrBefore(checkpoints, 1500)).toEqual({
      line: 1001,
      byteOffset: 5000,
    });
  });

  it("returns the last checkpoint for a line beyond every checkpoint (near/at EOF)", () => {
    expect(nearestCheckpointAtOrBefore(checkpoints, 999_999)).toEqual({
      line: 2001,
      byteOffset: 10000,
    });
  });

  it("returns the base checkpoint when there are no checkpoints at all", () => {
    expect(nearestCheckpointAtOrBefore([], 42)).toEqual({ line: 1, byteOffset: 0 });
  });
});

describe("UTF-8 validation", () => {
  it("accepts well-formed ASCII + multi-byte UTF-8", () => {
    expect(isWellFormedUtf8(Buffer.from("hello 你好 café", "utf8"))).toBe(true);
  });

  it("rejects a lone continuation byte", () => {
    expect(isWellFormedUtf8(Buffer.from([0x80]))).toBe(false);
  });

  it("rejects a truncated multi-byte sequence at EOF", () => {
    // 0xE4 0xBD is the start of a 3-byte sequence (你), missing its final byte.
    expect(isWellFormedUtf8(Buffer.from([0xe4, 0xbd]))).toBe(false);
  });

  it("rejects an overlong encoding", () => {
    // 0xC0 0x80 is an overlong encoding of NUL — invalid.
    expect(isWellFormedUtf8(Buffer.from([0xc0, 0x80]))).toBe(false);
  });

  it("rejects an encoded surrogate", () => {
    // 0xED 0xA0 0x80 would encode U+D800 (a surrogate) — invalid in UTF-8.
    expect(isWellFormedUtf8(Buffer.from([0xed, 0xa0, 0x80]))).toBe(false);
  });

  it("validates correctly across a chunk boundary mid-sequence", () => {
    const bytes = Buffer.from("你好", "utf8"); // 6 bytes, two 3-byte sequences
    const validator = new StreamingUtf8Validator();
    validator.push(bytes.subarray(0, 2));
    validator.push(bytes.subarray(2));
    expect(validator.finish()).toBe(true);
  });
});
