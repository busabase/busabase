import { describe, expect, it, vi } from "vitest";
import {
  buildAssetDownloadDisposition,
  createAssetDownloadResponse,
} from "../src/domains/assets/logic/asset-download-response";

const content = {
  assetId: "ast_download",
  storageKey: "attachments/blobs/report.pdf",
  url: "https://cdn.example.com/report.pdf",
  fileName: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 6,
  contentHash: "sha256:test",
};

describe("asset download response", () => {
  it("streams chunks with attachment headers and the requested Unicode name", async () => {
    const readChunks = vi.fn(async function* (storageKey: string) {
      expect(storageKey).toBe(content.storageKey);
      yield Buffer.from("abc");
      yield Buffer.from("123");
    });

    const response = createAssetDownloadResponse(content, "季度报告.pdf", readChunks);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe("6");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"____.pdf\"; filename*=UTF-8''%E5%AD%A3%E5%BA%A6%E6%8A%A5%E5%91%8A.pdf",
    );
    await expect(response.text()).resolves.toBe("abc123");
    expect(readChunks).toHaveBeenCalledOnce();
  });

  it("removes response-splitting characters from both filename forms", () => {
    const disposition = buildAssetDownloadDisposition('safe\r\nX-Evil: yes".txt');

    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    expect(disposition).toContain('filename="safe__X-Evil: yes_.txt"');
    expect(disposition).toContain("filename*=UTF-8''safe__X-Evil%3A%20yes%22.txt");
  });

  it("closes the chunk iterator when the browser cancels the download", async () => {
    const finalized = vi.fn();
    async function* chunks() {
      try {
        yield Buffer.from("first");
        yield Buffer.from("second");
      } finally {
        finalized();
      }
    }

    const response = createAssetDownloadResponse(content, null, chunks);
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();

    expect(finalized).toHaveBeenCalledOnce();
  });

  it("closes the chunk iterator and preserves a storage read failure", async () => {
    const finalized = vi.fn();
    async function* chunks() {
      try {
        yield Buffer.from("first");
        throw new Error("storage read failed");
      } finally {
        finalized();
      }
    }

    const response = createAssetDownloadResponse(content, null, chunks);

    await expect(response.arrayBuffer()).rejects.toThrow("storage read failed");
    expect(finalized).toHaveBeenCalledOnce();
  });
});
