import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { streamNdjsonRows } from "./full-importer.js";

describe("streamNdjsonRows — multi-byte UTF-8 across chunk boundaries", () => {
  it("correctly decodes a CJK character whose UTF-8 bytes are split across two stream chunks", async () => {
    // "你" is E4 BD A0 in UTF-8 (3 bytes) — split the underlying tar-stream
    // entry mid-character to reproduce what a real decompress+detar pipeline
    // does for arbitrary byte offsets. Without `body.setEncoding("utf8")` in
    // `streamNdjsonRows`, `readline` decodes each raw Buffer chunk with its
    // own naive `toString()`, mangling this into invalid JSON — reproduced
    // live restoring a real production space with Chinese commit messages
    // (`Unterminated string in JSON`), at an unpredictable row depending on
    // where the compression stream happened to split a chunk.
    const line = `${JSON.stringify({ id: "row_1", message: "你好，世界" })}\n`;
    const lineBytes = Buffer.from(line, "utf8");

    // Find a split point that lands strictly inside a multi-byte sequence
    // (a continuation byte, 0x80–0xBF) rather than on a character boundary.
    let splitAt = -1;
    for (let i = 1; i < lineBytes.length; i += 1) {
      if ((lineBytes[i] & 0xc0) === 0x80) {
        splitAt = i;
        break;
      }
    }
    expect(splitAt).toBeGreaterThan(0); // sanity: the fixture does contain multi-byte chars

    const chunk1 = lineBytes.subarray(0, splitAt);
    const chunk2 = lineBytes.subarray(splitAt);
    const body = Readable.from([chunk1, chunk2]);

    const sent: Array<Array<Record<string, unknown>>> = [];
    const count = await streamNdjsonRows(body, async (rows) => {
      sent.push(rows);
    });

    expect(count).toBe(1);
    expect(sent).toEqual([[{ id: "row_1", message: "你好，世界" }]]);
  });
});
