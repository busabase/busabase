import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import type { Dirent } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExactDumpReplayFixture } from "./helpers/exact-dump-replay";

const require = createRequire(import.meta.url);
const partBytes = 6 * 1024 * 1024;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const prefix = (spaceId: string) => `busabase/dump-staging-v1/${digest(Buffer.from(spaceId))}/`;

describe("multipart receipts survive a real HTTP server crash", () => {
  let dataDir: string;
  let storageDir: string;
  const children = new Set<ChildProcess>();
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-crash-parts-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-crash-parts-storage-"));
  });
  afterAll(async () => {
    await Promise.all(
      [...children].map(async (child) => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await once(child, "close");
        }
      }),
    );
    for (const dir of [dataDir, storageDir]) await rm(dir, { recursive: true, force: true });
  });
  const start = async () => {
    const child = spawn(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        require.resolve("tsx/esm"),
        path.join(__dirname, "helpers/dump-parts-http-server.ts"),
      ],
      {
        cwd: path.resolve(__dirname, "../../../apps/busabase"),
        env: {
          ...process.env,
          PG_DATABASE_URL: `pglite://${dataDir}`,
          STORAGE_URL: `local:${storageDir}?base_url=/api/test/storage`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.add(child);
    const port = await new Promise<number>((resolve, reject) => {
      let output = "";
      let errors = "";
      const timeout = setTimeout(
        () => reject(new Error(`Test HTTP server did not start: ${errors}`)),
        30_000,
      );
      child.stderr?.on("data", (data) => {
        errors += data.toString();
      });
      child.stdout?.on("data", (data) => {
        output += data.toString();
        const match = /DUMP_PARTS_READY (\d+)/.exec(output);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Test HTTP server exited (${code}): ${errors}`));
      });
    });
    const call = async (spaceId: string, operation: string, input: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/dump/import/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-busabase-space": spaceId },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
      return result as { sessionId: string; inserted?: number };
    };
    const stop = async () => {
      child.kill("SIGKILL");
      await once(child, "close");
      children.delete(child);
    };
    return { call, stop };
  };
  const files = async (directory: string): Promise<string[]> => {
    let entries: Dirent[];
    try {
      entries = await readdir(path.join(storageDir, directory), { withFileTypes: true });
    } catch {
      return [];
    }
    const result: string[] = [];
    for (const entry of entries) {
      const key = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await files(key)));
      else result.push(key);
    }
    return result;
  };
  const part = (key: string, bytes: Buffer, index: number) => ({
    storageKey: key,
    mimeType: "application/octet-stream",
    base64: bytes.subarray(index * partBytes, (index + 1) * partBytes).toString("base64"),
    chunk: { partNumber: index + 1, totalParts: 2, sizeBytes: bytes.length, sha256: digest(bytes) },
  });

  it("reclaims a dead owner's upload on resume, leaves other spaces and active sessions alone, then restores exact bytes", async () => {
    const a = "crash_parts_a";
    const b = "crash_parts_b";
    const bytes = Buffer.alloc(partBytes + 29, 99);
    const key = "attachments/crash-resume.bin";
    const otherKey = "attachments/foreign-pending.bin";
    const archiveA = createExactDumpReplayFixture({
      sourceSpaceId: "source",
      blobs: [{ key, bytes }],
    });
    const archiveB = createExactDumpReplayFixture({
      sourceSpaceId: "source",
      blobs: [{ key: otherKey, bytes }],
    });
    const first = await start();
    const oldA = await first.call(a, "begin", archiveA.beginInput());
    const oldB = await first.call(b, "begin", archiveB.beginInput());
    await first.call(a, "tables", {
      sessionId: oldA.sessionId,
      table: "attachmentBlobs",
      rows: [part(key, bytes, 0)],
    });
    await first.call(b, "tables", {
      sessionId: oldB.sessionId,
      table: "attachmentBlobs",
      rows: [part(otherKey, bytes, 0)],
    });
    expect((await files(prefix(a))).filter((key) => key.endsWith("receipt.json"))).toHaveLength(1);
    expect((await files(prefix(b))).filter((key) => key.endsWith("receipt.json"))).toHaveLength(1);
    expect(await readdir(path.join(storageDir, ".tmp/multipart"))).toHaveLength(2);
    const markerBeforeCrash = JSON.parse(
      await readFile(path.join(storageDir, prefix(a), "activity.json"), "utf8"),
    );
    expect(markerBeforeCrash.rootImported).toBe(false);
    expect(markerBeforeCrash.sourceArchiveChecksum).toBe(archiveA.sourceArchiveChecksum);
    expect(markerBeforeCrash.expectedTables).toEqual(archiveA.expectedTables);
    await first.stop();

    const restarted = await start();
    expect(
      JSON.parse(await readFile(path.join(storageDir, prefix(a), "activity.json"), "utf8"))
        .rootImported,
    ).toBe(false);
    await expect(restarted.call(a, "begin", archiveB.beginInput({ resume: true }))).rejects.toThrow(
      /archive|checksum|different/i,
    );
    const resumed = await restarted.call(a, "begin", archiveA.beginInput({ resume: true }));
    expect((await files(prefix(a))).filter((key) => key.endsWith("receipt.json"))).toEqual([]);
    expect((await files(prefix(b))).filter((key) => key.endsWith("receipt.json"))).toHaveLength(1);
    expect(await readdir(path.join(storageDir, ".tmp/multipart"))).toHaveLength(1);
    await archiveA.preflightWith((input) => restarted.call(a, "tables", input), resumed.sessionId);
    expect(
      JSON.parse(await readFile(path.join(storageDir, prefix(a), "activity.json"), "utf8"))
        .rootImported,
    ).toBe(false);
    await restarted.call(a, "tables", {
      sessionId: resumed.sessionId,
      table: "attachmentBlobs",
      rows: [part(key, bytes, 0)],
    });
    const concurrent = await restarted.call(a, "begin", archiveA.beginInput({ resume: true }));
    await archiveA.preflightWith(
      (input) => restarted.call(a, "tables", input),
      concurrent.sessionId,
    );
    // Explicit resume replaces the same-space owner and cleans its abandoned
    // multipart. An old owner must not continue writing after that handoff.
    expect((await files(prefix(a))).filter((key) => key.endsWith("receipt.json"))).toHaveLength(0);
    await expect(
      restarted.call(a, "tables", {
        sessionId: resumed.sessionId,
        table: "attachmentBlobs",
        rows: [part(key, bytes, 1)],
      }),
    ).rejects.toThrow(/session not found|another restore|owner|superseded/i);
    await restarted.call(a, "tables", {
      sessionId: concurrent.sessionId,
      table: "attachmentBlobs",
      rows: [part(key, bytes, 0)],
    });
    const last = {
      sessionId: concurrent.sessionId,
      table: "attachmentBlobs",
      rows: [part(key, bytes, 1)],
    };
    expect((await restarted.call(a, "tables", last)).inserted).toBe(1);
    expect((await restarted.call(a, "tables", last)).inserted).toBe(1);
    expect(digest(await readFile(path.join(storageDir, key)))).toBe(digest(bytes));
    const complete = async (spaceId: string, sessionId: string, archive: typeof archiveA) => {
      await restarted.call(spaceId, "tables", {
        sessionId,
        table: "nodes",
        rows: archive.rows.nodes,
      });
      await restarted.call(spaceId, "commit", { sessionId });
    };
    await complete(a, concurrent.sessionId, archiveA);
    const cleanB = await restarted.call(b, "begin", archiveB.beginInput({ resume: true }));
    await archiveB.preflightWith((input) => restarted.call(b, "tables", input), cleanB.sessionId);
    for (const index of [0, 1])
      await restarted.call(b, "tables", {
        sessionId: cleanB.sessionId,
        table: "attachmentBlobs",
        rows: [part(otherKey, bytes, index)],
      });
    expect(digest(await readFile(path.join(storageDir, otherKey)))).toBe(digest(bytes));
    await complete(b, cleanB.sessionId, archiveB);
    // Only the deliberate completed-archive identities persist. No activity,
    // multipart receipt or staged bytes may survive a successful completion.
    expect((await files("busabase/dump-staging-v1")).sort()).toEqual(
      [prefix(a) + "completed.json", prefix(b) + "completed.json"].sort(),
    );
    for (const [spaceId, archive] of [
      [a, archiveA],
      [b, archiveB],
    ] as const) {
      const completed = JSON.parse(
        await readFile(path.join(storageDir, prefix(spaceId), "completed.json"), "utf8"),
      );
      expect(completed.sourceArchiveChecksum).toBe(archive.sourceArchiveChecksum);
      expect(completed.expectedTables).toEqual(archive.expectedTables);
    }
    expect(await readdir(path.join(storageDir, ".tmp/multipart"))).toEqual([]);
    await restarted.stop();
  }, 90_000);
});
