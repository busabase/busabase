import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBusabaseClient } from "busabase-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRestore } from "../commands.js";
import {
  drainEntry,
  readEntryText,
  streamArchive,
  verifyArchive,
} from "../format/archive-reader.js";
import { exportFull } from "./full-exporter.js";
import { withStrictSnapshotTransport } from "./snapshot-transport.js";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
type Host = { origin: string; child: ChildProcess };

describe("native SQL snapshot backup and restore over real HTTP/PGlite", () => {
  let directory: string;
  let source: Host;
  let target: Host;
  let conflict: Host;
  const children = new Set<ChildProcess>();
  const start = async (role: string, bigBytes = 0): Promise<Host> => {
    const suffix = `${role}-${children.size}`;
    const child = spawn(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        require.resolve("tsx/esm"),
        join(here, "helpers/snapshot-http-host.mjs"),
      ],
      {
        cwd: resolve(here, "../../../../busabase"),
        env: {
          ...process.env,
          PG_DATABASE_URL: `pglite://${join(directory, suffix, "pgdata")}`,
          SNAPSHOT_FIXTURE_STORAGE: join(directory, suffix, "storage"),
          SNAPSHOT_FIXTURE_ROLE: role,
          SNAPSHOT_FIXTURE_BIG_BYTES: String(bigBytes),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.add(child);
    const origin = await new Promise<string>((resolve, reject) => {
      let output = "",
        errors = "";
      const timer = setTimeout(
        () => reject(new Error(`Fixture startup timed out: ${errors}`)),
        90_000,
      );
      child.stdout?.on("data", (part) => {
        output += String(part);
        const match = /SNAPSHOT_HTTP_READY (\{[^\n]+\})/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(JSON.parse(match[1]).origin);
        }
      });
      child.stderr?.on("data", (part) => {
        errors = (errors + String(part)).slice(-16000);
      });
      child.once("error", (error) => {
        children.delete(child);
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Fixture exited ${code}: ${errors}`));
      });
    });
    return { origin, child };
  };
  const client = (host: Host) =>
    createBusabaseClient({
      baseUrl: host.origin,
      apiKey: "",
      spaceId: "local",
      fetch: withStrictSnapshotTransport(fetch),
    });
  const backup = (host: Host, outPath: string, resume = false) =>
    exportFull({
      client: client(host),
      outPath,
      sourceHost: host.origin,
      spaceId: "local",
      includeHistory: true,
      toolVersion: "snapshot-http-test",
      retries: 0,
      resume,
    });
  const restore = (host: Host, archivePath: string) =>
    runRestore(client(host), { file: archivePath, json: true }) as Promise<{
      restored: boolean;
      warnings: string[];
    }>;
  const inspect = async (host: Host) =>
    (await fetch(`${host.origin}/fixture/inspect`)).json() as Promise<any>;
  const control = async (value: Record<string, unknown>) => {
    const response = await fetch(`${source.origin}/fixture/control`, {
      method: "POST",
      body: JSON.stringify(value),
    });
    expect(response.status).toBe(200);
  };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "busabase-snapshot-native-"));
    source = await start("source");
    target = await start("target");
    conflict = await start("conflict");
  }, 180_000);
  afterAll(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const exit = once(child, "close");
        child.kill("SIGTERM");
        await exit;
      }
    await rm(directory, { recursive: true, force: true });
  });
  it("uses one snapshot, copies readable foreign content without its metadata, and preserves microseconds", async () => {
    const archivePath = join(directory, "roundtrip.bbdump");
    const manifest = await backup(source, archivePath);
    expect(manifest.sqlCapture?.mode).toBe("repeatable-read");
    expect(manifest.sqlCapture?.tables.attachments).toBe(2);
    expect(manifest.tables.attachments).toBe(3);
    expect(manifest.attachmentMaterializations).toEqual([
      expect.objectContaining({
        assetId: "ast_own_foreign",
        attachmentId: "att_foreign",
        originalAttachmentOwnershipOmitted: true,
      }),
    ]);
    expect(JSON.stringify(manifest)).not.toContain("foreign-owner-never-export");
    await expect(verifyArchive(archivePath)).resolves.toEqual(manifest);
    expect((await restore(target, archivePath)).warnings).toEqual([]);
    const actual = await inspect(target);
    expect(actual.attachments.find((row: any) => row.id === "att_foreign")).toMatchObject({
      spaceId: "local",
      userId: "fixture-user",
      context: "busabase-backup-dependency",
      metadata: { busabaseBackupDependency: { sourceAssetId: "ast_own_foreign" } },
    });
    expect(JSON.stringify(actual)).not.toContain("foreign-metadata-never-export");
    expect(JSON.stringify(actual)).not.toContain("foreign-secret-context");
    expect(actual.docSha256).toBe(sha("# Preserved �🙂\n"));
    expect(actual.times.find((row: any) => row.id === "nod_fixture_doc")).toMatchObject({
      createdAt: "2026-11-11T01:02:03.123456Z",
      updatedAt: "2026-11-11T04:05:06.654321Z",
    });
  }, 180_000);
  it("preserves legal own keys and JSON scalar types from raw SQL through archive, HTTP restore and resume", async () => {
    const archivePath = join(directory, "roundtrip.bbdump");
    const expected = (await inspect(source)).opaqueProof;
    const actual = (await inspect(target)).opaqueProof;
    expect(actual).toEqual(expected);
    const archived: Record<string, Array<Record<string, unknown>>> = {};
    await streamArchive(archivePath, async (entry) => {
      const match = /^tree\/(nodes|commits|fieldValues)\.ndjson$/.exec(entry.path);
      if (!match) {
        await drainEntry(entry.body);
        return;
      }
      archived[match[1]] = (await readEntryText(entry.body))
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
    });
    for (const row of expected.nodes) {
      const archivedNode = archived.nodes.find((node) => node.id === row.id);
      if (!archivedNode) throw new Error("Source node missing from archive");
      for (const [column, raw] of [
        ["metadata", row.metadataText],
        ["settings", row.settingsText],
        ["agentPrompts", row.agentPromptsText],
      ] as const) {
        const original = raw === null ? null : JSON.parse(raw);
        expect(archivedNode[column], `${row.id}.${column}`).toEqual(original);
        const nested = Array.isArray(original) ? original[0] : original;
        expect(Object.hasOwn(nested, "__proto__")).toBe(true);
        expect(Object.hasOwn(nested, "constructor")).toBe(true);
        expect(Object.hasOwn(nested, "toJSON")).toBe(true);
        expect(Object.hasOwn(nested.array[0], "__proto__")).toBe(true);
      }
    }
    for (const row of expected.commits)
      expect(archived.commits.find((commit) => commit.id === row.id)?.payload).toEqual(
        JSON.parse(row.payloadText),
      );
    for (const row of expected.cells) {
      const value = row.valueJsonText === null ? null : JSON.parse(row.valueJsonText);
      expect(archived.fieldValues.find((cell) => cell.id === row.id)?.valueJson).toEqual(value);
    }
    expect(expected.cells.map((row: { jsonType: string }) => row.jsonType)).toEqual([
      "object",
      "string",
      "string",
      "array",
      "boolean",
      "number",
      null,
    ]);
    expect(JSON.parse(expected.cells[1].valueJsonText)).toBe("[1,2]");
    expect(
      await runRestore(client(target), { file: archivePath, json: true, resume: true }),
    ).toMatchObject({ restored: true, warnings: [] });
    expect((await inspect(target)).opaqueProof).toEqual(expected);
  }, 180_000);

  it("preflights every existing row for same-archive resume and refuses a different completed archive", async () => {
    const original = join(directory, "roundtrip.bbdump");
    const resumed = await runRestore(client(target), { file: original, json: true, resume: true });
    expect(resumed).toMatchObject({ restored: true, warnings: [] });
    const before = await inspect(target);
    await control({ failBlob: false, mutableContent: "alt-data" });
    const changed = join(directory, "different-archive.bbdump");
    await backup(source, changed);
    await expect(
      runRestore(client(target), { file: changed, json: true, resume: true }),
    ).rejects.toThrow(
      /different.*archive|archive.*different|checksum|another archive|restore history/i,
    );
    const after = await inspect(target);
    expect(after.blobs).toEqual(before.blobs);
    expect(after.times).toEqual(before.times);
  }, 180_000);

  it("refreshes equal-length mutable bytes without a registered source hash on resume", async () => {
    const archivePath = join(directory, "resume.bbdump");
    await control({ failBlob: true, mutableContent: "old-data" });
    await expect(backup(source, archivePath)).rejects.toThrow();
    await control({ failBlob: false, mutableContent: "new-data" });
    const manifest = await backup(source, archivePath, true);
    const freshTarget = await start("target");
    await restore(freshTarget, archivePath);
    const actual = await inspect(freshTarget);
    expect(actual.blobs.find((row: any) => row.key === "attachments/mutable.txt").sha256).toBe(
      sha("new-data"),
    );
    expect(manifest.sqlCapture?.mode).toBe("repeatable-read");
  }, 180_000);
  it("rejects tampered cached bytes when this source capture has a registered hash", async () => {
    const archivePath = join(directory, "tampered-cache.bbdump");
    await control({ failBlob: true });
    await expect(backup(source, archivePath)).rejects.toThrow();
    const cached = join(
      `${archivePath}.attachment-blobs.part`,
      `${sha("attachments/foreign.txt")}.bin`,
    );
    const bytes = await readFile(cached);
    await writeFile(cached, Buffer.alloc(bytes.length, 0x62));
    await control({ failBlob: false });
    await expect(backup(source, archivePath, true)).rejects.toThrow(/hash mismatch/i);
  }, 180_000);

  it("rejects target foreign-key ownership conflicts without overwriting its original bytes", async () => {
    const archivePath = join(directory, "conflict.bbdump");
    await backup(source, archivePath);
    await expect(restore(conflict, archivePath)).rejects.toThrow(
      /another space|different space|referenced/i,
    );
    const actual = await inspect(conflict);
    expect(actual.blobs.find((row: any) => row.key === "attachments/foreign.txt").sha256).toBe(
      sha("untouched"),
    );
    expect(actual.assets).toHaveLength(0);
    expect(actual.nodes).toHaveLength(1);
  }, 180_000);
  it.skipIf(process.env.RUN_LARGE_SNAPSHOT_HTTP !== "1")(
    "streams a real 95MB commit through SSE, the archive and native restore",
    async () => {
      const size = 95_227_277;
      const bigSource = await start("source", size);
      const bigTarget = await start("target");
      const archivePath = join(directory, "large95.bbdump");
      const manifest = await backup(bigSource, archivePath);
      expect(manifest.tables.commits).toBe(2);
      await restore(bigTarget, archivePath);
      const actual = await inspect(bigTarget);
      expect(actual.commits).toEqual([
        expect.objectContaining({
          id: "cmt_large",
          largeSha256: sha(`${"x".repeat(size - 8)}�🙂`),
        }),
      ]);
    },
    300_000,
  );
});
