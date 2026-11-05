import { describe, expect, it, vi } from "vitest";
import { type PutPart, uploadMultipartParts } from "./multipart-upload";

const upload = { storageKey: "attachments/u/file-tree/k.bin", uploadId: "up-1" };

const signer = () =>
  vi.fn(async ({ partNumbers }: { partNumbers: number[] }) => ({
    parts: partNumbers.map((partNumber) => ({ partNumber, uploadUrl: `url-${partNumber}` })),
    expiresIn: 3600,
  }));

const noSleep = async () => {};

describe("uploadMultipartParts", () => {
  it("slices uniform parts, uploads them with bounded concurrency and reports aggregate progress", async () => {
    const file = new Blob(["a".repeat(10)]);
    let inFlight = 0;
    let maxInFlight = 0;
    const bodies = new Map<string, number>();
    const putPart: PutPart = async ({ url, body, onProgress }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      onProgress(Math.floor(body.size / 2));
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      bodies.set(url, body.size);
    };
    const progress: number[] = [];
    await uploadMultipartParts({
      file,
      upload: { ...upload, partSize: 3, partCount: 4 },
      signParts: signer(),
      putPart,
      concurrency: 2,
      onProgress: (percent) => progress.push(percent),
    });

    // Every part but the last has the same size (R2 requires it).
    expect([...bodies.entries()].sort()).toEqual([
      ["url-1", 3],
      ["url-2", 3],
      ["url-3", 3],
      ["url-4", 1],
    ]);
    expect(maxInFlight).toBe(2);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("signs part URLs in batches rather than one request per part", async () => {
    const signParts = signer();
    await uploadMultipartParts({
      file: new Blob(["x".repeat(5)]),
      upload: { ...upload, partSize: 1, partCount: 5 },
      signParts,
      putPart: async () => {},
    });
    expect(signParts).toHaveBeenCalledTimes(1);
    expect(signParts.mock.calls[0]?.[0]).toMatchObject({ partNumbers: [1, 2, 3, 4, 5] });
  });

  it("retries a failing part with backoff and a freshly signed URL", async () => {
    const signParts = signer();
    let failures = 0;
    const delays: number[] = [];
    const uploaded: string[] = [];
    await uploadMultipartParts({
      file: new Blob(["xy"]),
      upload: { ...upload, partSize: 1, partCount: 2 },
      signParts,
      putPart: async ({ url }) => {
        if (url === "url-2" && failures < 2) {
          failures++;
          throw new Error("Upload failed (503)");
        }
        uploaded.push(url);
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(uploaded.sort()).toEqual(["url-1", "url-2"]);
    expect(delays).toEqual([1000, 2000]);
    // Initial batch + one fresh single-part signature per retry.
    expect(signParts).toHaveBeenCalledTimes(3);
  });

  it("gives up after the attempt limit and stops the other parts", async () => {
    const started: number[] = [];
    await expect(
      uploadMultipartParts({
        file: new Blob(["x".repeat(8)]),
        upload: { ...upload, partSize: 1, partCount: 8 },
        signParts: signer(),
        concurrency: 1,
        maxAttempts: 3,
        sleep: noSleep,
        putPart: async ({ url }) => {
          const partNumber = Number(url.split("-")[1]);
          started.push(partNumber);
          if (partNumber === 2) throw new Error("Upload failed (500)");
        },
      }),
    ).rejects.toThrow("Upload failed (500)");
    // Part 2 tried three times; nothing after it was started.
    expect(started).toEqual([1, 2, 2, 2]);
  });

  it("rejects with an AbortError when cancelled and does not retry", async () => {
    const controller = new AbortController();
    const putPart = vi.fn<PutPart>(async ({ signal }) => {
      controller.abort();
      if (signal?.aborted) {
        const error = new Error("Upload cancelled");
        error.name = "AbortError";
        throw error;
      }
    });
    await expect(
      uploadMultipartParts({
        file: new Blob(["xy"]),
        upload: { ...upload, partSize: 1, partCount: 2 },
        signParts: signer(),
        concurrency: 1,
        signal: controller.signal,
        sleep: noSleep,
        putPart,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(putPart).toHaveBeenCalledTimes(1);
  });

  it("does not need an ETag from the store (a bucket whose CORS hides it still works)", async () => {
    // The server lists the stored parts itself at completion, so a part PUT
    // only has to succeed — Busabase Cloud's production R2 bucket does not
    // expose the ETag header to the browser.
    await expect(
      uploadMultipartParts({
        file: new Blob(["xyz"]),
        upload: { ...upload, partSize: 1, partCount: 3 },
        signParts: signer(),
        putPart: async () => {},
      }),
    ).resolves.toBeUndefined();
  });
});
