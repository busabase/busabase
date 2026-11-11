import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyArchive } from "./backup/format/archive-reader.js";
import { ArchiveWriter } from "./backup/format/archive-writer.js";
import { runCli } from "./run.js";

describe("restore --dry-run through the CLI", () => {
  let directory: string;
  let archivePath: string;
  let configPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "busabase-restore-dry-run-"));
    archivePath = join(directory, "space.bbdump");
    configPath = join(directory, "local.env");
    await writeFile(configPath, "BUSABASE_API_KEY=\n");
    const writer = ArchiveWriter.create(archivePath);
    await writer.addBuffer(
      "tree/attachmentBlobs.ndjson",
      `${JSON.stringify({ storageKey: "test/blob.txt", base64: "aGVsbG8=" })}\n`,
    );
    await writer.addBuffer(
      "tree/nodes.ndjson",
      `${JSON.stringify({ id: "nod_root", parentId: null, type: "folder" })}\n`,
    );
    await writer.finalize({
      formatVersion: 1,
      toolVersion: "test",
      exportedAt: "2026-11-10T00:00:00.000Z",
      spaceId: "source-space",
      sourceHost: "http://source.invalid",
      fidelity: "full",
      excludesSecrets: true,
      tables: { nodes: 1 },
      blobCount: 1,
      blobBytes: 5,
      textBlobCount: 0,
      textBlobBytes: 0,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  const args = (archive: string, config: string, extra: string[] = []) => [
    "restore",
    archive,
    "--base-url",
    "http://127.0.0.1:15419",
    "--api-key",
    "local-test-key",
    "--space-id",
    "target-space",
    "--config",
    config,
    "--output",
    "json",
    "--dry-run",
    ...extra,
  ];

  it.each([{ extra: [] }, { extra: ["--resume"] }])(
    "verifies real archive bytes without any restore or storage request (flags $extra)",
    async ({ extra }) => {
      const transport = vi.fn(async () => {
        throw new Error("Dry-run must not reach the server");
      });
      vi.stubGlobal("fetch", transport);
      const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      expect(await runCli(args(archivePath, configPath, extra))).toBe(0);
      expect(transport).not.toHaveBeenCalled();
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toMatchObject({
        dryRun: true,
        restored: false,
        sourceSpaceId: "source-space",
        checksumVerified: true,
        rows: 1,
        blobCount: 1,
        targetChecked: false,
        resume: extra.length > 0,
      });
    },
  );

  it.each([{ dryRun: true }, { dryRun: false }])(
    "rejects a checksum-valid future table before any HTTP request (dryRun=$dryRun)",
    async ({ dryRun }) => {
      const writer = ArchiveWriter.create(archivePath);
      await writer.addBuffer(
        "tree/futureTable.ndjson",
        `${JSON.stringify({ id: "future-row" })}\n`,
      );
      await writer.finalize({
        formatVersion: 2,
        toolVersion: "future-test",
        exportedAt: "2026-11-11T00:00:00Z",
        spaceId: "source",
        sourceHost: "http://source.invalid",
        fidelity: "full",
        excludesSecrets: true,
        tables: { futureTable: 1 },
        blobCount: 0,
        blobBytes: 0,
        textBlobCount: 0,
        textBlobBytes: 0,
      });
      // Integrity inspection remains generic; restore support is a separate guard.
      await expect(verifyArchive(archivePath)).resolves.toMatchObject({
        tables: { futureTable: 1 },
      });
      const transport = vi.fn(async () => {
        throw new Error("Unsupported archives must not reach the server");
      });
      vi.stubGlobal("fetch", transport);
      const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const diagnostics = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const requested = args(archivePath, configPath).filter(
        (argument) => dryRun || argument !== "--dry-run",
      );
      expect(await runCli(requested)).not.toBe(0);
      expect(transport).not.toHaveBeenCalled();
      const message = [...output.mock.calls, ...diagnostics.mock.calls].flat().join("\n");
      expect(message).toContain("futureTable");
      expect(message).toContain("Update busabase-cli");
    },
  );

  it("rejects a truncated archive without beginning or aborting an import", async () => {
    const bytes = await readFile(archivePath);
    await writeFile(archivePath, bytes.subarray(0, Math.floor(bytes.length / 2)));
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await runCli(args(archivePath, configPath))).not.toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });
});
