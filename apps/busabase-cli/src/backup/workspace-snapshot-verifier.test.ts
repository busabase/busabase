import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  compareArchive,
  compareWorkspace,
  fetchDumpPage,
  isRetryableDumpFetchError,
  rowFingerprint,
  snapshotWorkspace,
  TABLES,
} from "../../scripts/verify-workspace-snapshot.mjs";
import { ArchiveWriter } from "./format/archive-writer.js";

describe("workspace snapshot verifier with real local HTTP, SQLite and files", () => {
  let directory: string,
    storage: string,
    targetStorage: string,
    server: http.Server,
    baseUrl: string;
  let rows: Record<string, Array<Record<string, unknown>>>;
  let requests: Array<{
    method: string | undefined;
    space: string | string[] | undefined;
    authorization: string | undefined;
  }>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "busabase-fingerprint-test-"));
    storage = join(directory, "source");
    targetStorage = join(directory, "target");
    await mkdir(join(storage, "attachments"), { recursive: true });
    await mkdir(join(targetStorage, "attachments"), { recursive: true });
    await writeFile(join(storage, "attachments/a.bin"), Buffer.from([0, 1, 255]));
    await writeFile(join(targetStorage, "attachments/a.bin"), Buffer.from([0, 1, 255]));
    rows = Object.fromEntries(TABLES.map((table) => [table, []]));
    rows.nodes = [
      {
        id: "nod_root",
        type: "folder",
        createdBy: null,
        createdAt: "2026-11-10T00:00:00Z",
        updatedAt: "2026-11-10T00:00:00Z",
        settings: { icon: "source" },
      },
      {
        id: "doc",
        type: "doc",
        nested: JSON.parse('{"__proto__":{"own":true},"constructor":"data","array":[1,2]}'),
      },
    ];
    rows.records = [
      { id: "record", nested: { b: true, a: { text: "你好\r\n" } }, array: ["first", "second"] },
    ];
    requests = [];
    server = http.createServer(async (req, res) => {
      requests.push({
        method: req.method,
        space: req.headers["x-busabase-space"],
        authorization: req.headers.authorization,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const all = rows[body.table];
      const start = Number(body.cursor ?? 0);
      const page = all.slice(start, start + body.limit);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          rows: page,
          nextCursor: start + page.length < all.length ? String(start + page.length) : null,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing local address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const options = (baseUrl: string, storageDir: string, snapshotDir: string) => ({
    baseUrl,
    spaceId: "local",
    storageDir,
    snapshotDir,
    pageLimit: 1,
  });

  it("preserves arbitrary own JSON keys and array order, rejecting invalid values", () => {
    expect(canonicalJson(JSON.parse('{"__proto__":{"value":1},"constructor":"own"}'))).toBe(
      '{"__proto__":{"value":1},"constructor":"own"}',
    );
    expect(() => canonicalJson({ own: undefined })).toThrow("Unsupported");
    expect(() => rowFingerprint("records", { missing: "id" })).toThrow("no valid id");
    expect(() => rowFingerprint("nodes", { id: "nod_root", createdBy: null })).toThrow(
      "missing createdAt",
    );
    expect(rowFingerprint("records", { id: "r", array: [1, 2] })).not.toEqual(
      rowFingerprint("records", { id: "r", array: [2, 1] }),
    );
  });

  it("uses the real space primary key for singleton settings and hashes every stored column", () => {
    const instructions = {
      spaceId: "local",
      body: "原始说明",
      version: 3,
      updatedAt: "2026-11-11T00:00:00Z",
    };
    expect(rowFingerprint("spaceInstructions", instructions).id).toBe("local");
    expect(rowFingerprint("spaceInstructions", instructions).sha256).not.toBe(
      rowFingerprint("spaceInstructions", { ...instructions, body: "changed" }).sha256,
    );
    expect(rowFingerprint("spaceWelcome", { spaceId: "local", nodeId: "welcome" }).id).toBe(
      "local",
    );
    expect(() => rowFingerprint("records", { spaceId: "local" })).toThrow("no valid id");
  });

  it("compares exact fingerprints after source files are removed, normalizing only seeded root host columns", async () => {
    const snapshot = join(directory, "fingerprints");
    const saved = await snapshotWorkspace(options(baseUrl, storage, snapshot));
    expect(saved.rows).toBe(3);
    const db = new DatabaseSync(join(snapshot, "fingerprints.sqlite"), { readOnly: true });
    expect(db.prepare("SELECT COUNT(*) AS n FROM rows").get()?.n).toBe(3);
    db.close();
    await rm(storage, { recursive: true });
    rows.nodes[0].createdAt = "2026-11-11T00:00:00Z";
    rows.nodes[0].updatedAt = "2026-11-11T01:00:00Z";
    rows.nodes[0].createdBy = "new-host";
    rows.records[0].nested = { a: { text: "你好\r\n" }, b: true };
    const compared = await compareWorkspace(options(baseUrl, targetStorage, snapshot));
    expect(compared.passed).toBe(true);
    expect(compared.rows).toBe(3);
    expect(compared.objects.identical).toBe(1);
    expect(requests.length).toBeGreaterThan(36);
    expect(
      requests.every(
        (req) => req.method === "POST" && req.space === "local" && req.authorization === undefined,
      ),
    ).toBe(true);
    expect(JSON.parse(await readFile(join(snapshot, "comparison.json"), "utf8")).passed).toBe(true);
  });

  it("reports missing and extra ids, real field changes, and corrupt/missing/extra object bytes", async () => {
    const snapshot = join(directory, "fingerprints");
    await writeFile(join(storage, "attachments/missing.bin"), "missing");
    await snapshotWorkspace(options(baseUrl, storage, snapshot));
    rows.nodes = rows.nodes.slice(0, 1);
    rows.nodes[0].settings = { icon: "different" };
    rows.records.push({ id: "extra", content: "new" });
    rows.records[0].array = ["second", "first"];
    await writeFile(join(targetStorage, "attachments/a.bin"), "corrupt");
    await writeFile(join(targetStorage, "attachments/extra.bin"), "extra");
    const compared = await compareWorkspace(options(baseUrl, targetStorage, snapshot));
    expect(compared.passed).toBe(false);
    expect(compared.tables.nodes).toMatchObject({ missing: 1, mismatched: 1 });
    expect(compared.tables.records).toMatchObject({ extra: 1, mismatched: 1 });
    expect(compared.objects).toMatchObject({ missing: 1, extra: 1, mismatched: 1 });
  });

  it("independently checks a raw v2 archive against saved fingerprints without the source service/files", async () => {
    const snapshot = join(directory, "fingerprints");
    await snapshotWorkspace(options(baseUrl, storage, snapshot));
    const payload = Buffer.from([0, 1, 255]),
      key = "attachments/a.bin";
    const digest = createHash("sha256").update(payload).digest("hex"),
      pathDigest = createHash("sha256").update(key).digest("hex");
    const createArchive = async (name: string, declaredHash = digest) => {
      const path = join(directory, name);
      const writer = ArchiveWriter.create(path);
      await writer.addBuffer(
        `blobs/attachments/${pathDigest}.json`,
        JSON.stringify({
          storageKey: key,
          mimeType: "application/octet-stream",
          bytes: payload.length,
          sha256: declaredHash,
        }),
      );
      await writer.addBuffer(`blobs/attachments/${pathDigest}.bin`, payload);
      for (const table of TABLES)
        await writer.addBuffer(
          `tree/${table}.ndjson`,
          rows[table].map((row) => JSON.stringify(row)).join("\n"),
        );
      await writer.finalize({
        formatVersion: 2,
        toolVersion: "test",
        exportedAt: "2026-11-11T00:00:00Z",
        spaceId: "local",
        sourceHost: baseUrl,
        fidelity: "full",
        excludesSecrets: true,
        tables: Object.fromEntries(TABLES.map((table) => [table, rows[table].length])),
        blobCount: 1,
        blobBytes: payload.length,
        textBlobCount: 0,
        textBlobBytes: 0,
      });
      return path;
    };
    const valid = await createArchive("valid.bbdump");
    const badBody = await createArchive("invalid-body.bbdump", "0".repeat(64));
    const readRequests = requests.length;
    await rm(storage, { recursive: true });
    const compared = await compareArchive(snapshot, valid);
    expect(compared.passed).toBe(true);
    expect(compared.rows).toBe(3);
    expect(compared.objects.identical).toBe(1);
    expect(requests).toHaveLength(readRequests);
    await expect(compareArchive(snapshot, badBody)).rejects.toThrow("metadata/body mismatch");
    rows.records[0].array = ["changed"];
    const changed = await compareArchive(snapshot, await createArchive("changed.bbdump"));
    expect(changed.passed).toBe(false);
    expect(changed.tables.records.mismatched).toBe(1);
  });

  it("fails on staged files or remote endpoints instead of ignoring them", async () => {
    await mkdir(join(storage, ".tmp"));
    await writeFile(join(storage, ".tmp/incomplete"), "not finalized");
    await expect(
      snapshotWorkspace(options(baseUrl, storage, join(directory, "fingerprints"))),
    ).rejects.toThrow("staged storage object");
    await expect(
      snapshotWorkspace(options("https://busabase.com", storage, join(directory, "remote"))),
    ).rejects.toThrow("loopback");
  });

  it("retries abrupt dump connection drops and still reads the page", async () => {
    expect(isRetryableDumpFetchError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableDumpFetchError(new Error("Input validation failed"))).toBe(false);

    let remainingFails = 2;
    let successfulForwards = 0;
    const flaky = http.createServer(async (req, res) => {
      if (remainingFails > 0) {
        remainingFails -= 1;
        req.socket.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const all = rows[body.table] ?? [];
      const start = Number(body.cursor ?? 0);
      const page = all.slice(start, start + body.limit);
      successfulForwards += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          rows: page,
          nextCursor: start + page.length < all.length ? String(start + page.length) : null,
        }),
      );
    });
    await new Promise<void>((resolve) => flaky.listen(0, "127.0.0.1", resolve));
    const address = flaky.address();
    if (!address || typeof address === "string") throw new Error("missing flaky address");
    const flakyUrl = `http://127.0.0.1:${address.port}`;
    try {
      const page = await fetchDumpPage(
        {
          baseUrl: flakyUrl,
          spaceId: "local",
          storageDir: storage,
          snapshotDir: join(directory, "unused-snapshot"),
          pageLimit: 10,
        },
        "nodes",
        undefined,
      );
      expect(page.rows).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
      expect(remainingFails).toBe(0);
      expect(successfulForwards).toBe(1);
    } finally {
      await new Promise<void>((resolve) => flaky.close(() => resolve()));
    }
  });
});
