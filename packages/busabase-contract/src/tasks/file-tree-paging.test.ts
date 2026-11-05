import { describe, expect, it, vi } from "vitest";
import { nodeListFilesTask } from "./file-tree";
import type { BusabaseTaskClient } from "./types";

/**
 * `node_files_list` follows the path cursor so a Drive bigger than one page is
 * still listed completely. A Busabase that predates paging ignores `limit` and
 * `after` and answers with the SAME full list every time — the loop has to
 * notice and stop, or `busabase-cli drives files` never returns.
 */

/** One page of `count` paths, oldest first. */
const page = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    path: `file-${String(index).padStart(5, "0")}.md`,
    assetId: `ast_${index}`,
    name: `file-${String(index).padStart(5, "0")}.md`,
    size: 1,
    mimeType: "text/markdown",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));

const clientWith = (listFiles: ReturnType<typeof vi.fn>) =>
  ({ fileTrees: { listFiles } }) as unknown as BusabaseTaskClient;

/** The task's result is opaque (`unknown`); every case here lists files. */
const listAll = async (client: BusabaseTaskClient) =>
  (await nodeListFilesTask.execute(client, {
    kind: "drive",
    nodeId: "nod_big",
  })) as { path: string }[];

describe("node_files_list paging", () => {
  it("stops at a server that ignores the cursor instead of looping forever", async () => {
    // 5,001 rows: one more than the page size, so an old server's single "page"
    // looks like it has a next one.
    const rows = page(5_001);
    const asked: { after?: string }[] = [];
    const listFiles = vi.fn(async (input: { after?: string }) => {
      asked.push(input);
      return rows;
    });
    const files = await listAll(clientWith(listFiles));

    // The first answer already held everything, so it is returned once.
    expect(files).toHaveLength(5_001);
    expect(new Set(files.map((file) => file.path)).size).toBe(5_001);
    expect(asked).toHaveLength(2);
    // The second request asks past the last path — and gets the same page back.
    expect(asked[1]).toMatchObject({ after: "file-05000.md" });
  });

  it("stops when the cursor does not advance", async () => {
    // A server that honours `limit` but ends every page on the cursor's own row:
    // the last path never changes, so following it again repeats the page.
    const first = page(5_000);
    const second = Array.from({ length: 5_000 }, () => ({ ...first[4_999] }));
    const listFiles = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(second);
    const files = await listAll(clientWith(listFiles));
    expect(files).toHaveLength(5_000);
    expect(listFiles).toHaveBeenCalledTimes(2);
  });

  it("walks a paging server to the end", async () => {
    const rows = page(5_001);
    const listFiles = vi.fn(async ({ after }: { after?: string }) => {
      if (!after) return rows.slice(0, 5_000);
      return rows.filter((row) => row.path > after);
    });
    const files = await listAll(clientWith(listFiles));
    expect(files).toHaveLength(5_001);
    expect(listFiles).toHaveBeenCalledTimes(2);
  });
});
