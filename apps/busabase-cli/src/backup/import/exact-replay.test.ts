import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BusabaseClient } from "busabase-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRestore } from "../commands.js";
import { ArchiveWriter } from "../format/archive-writer.js";
import { FORMAT_VERSION } from "../format/manifest.js";
import { IMPORT_ORDER } from "./full-importer.js";

let dir: string, path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "exact-replay-cli-"));
  path = join(dir, "archive.bbdump");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function archive(version: 1 | 2 | 3 = FORMAT_VERSION) {
  const writer = ArchiveWriter.create(path);
  await writer.addBuffer(
    "tree/attachmentBlobs.ndjson",
    `${JSON.stringify({
      storageKey: "attachments/body",
      mimeType: "text/plain",
      base64: Buffer.from("body").toString("base64"),
    })}\n`,
  );
  await writer.addBuffer(
    "tree/nodes.ndjson",
    `${JSON.stringify({
      id: "nod_root",
      parentId: null,
      type: "folder",
      name: "Original metadata",
      metadata: { array: [1, null, "�🙂"] },
    })}\n`,
  );
  await writer.addBuffer(
    "tree/attachments.ndjson",
    `${JSON.stringify({ id: "att_body", storageKey: "attachments/body" })}\n`,
  );
  await writer.addBuffer("docs/nod_root.md", "Original body");
  return writer.finalize({
    formatVersion: version,
    toolVersion: "test",
    exportedAt: "2026-11-11T00:00:00Z",
    spaceId: "source",
    sourceHost: "http://fixture.invalid",
    fidelity: "full",
    excludesSecrets: true,
    tables: { nodes: 1, attachments: 1 },
    blobCount: 1,
    blobBytes: 4,
    textBlobCount: 0,
    textBlobBytes: 0,
    sqlCapture: {
      version: 1,
      mode: "repeatable-read",
      startedAt: "2026-11-11T00:00:00Z",
      completedAt: "2026-11-11T00:00:01Z",
      tables: { nodes: 1, attachments: 1 },
    },
  });
}
function target(
  options: { ack?: boolean; ignoreValidation?: boolean; conflict?: boolean } = { ack: true },
) {
  const counts: Record<string, number> = {};
  const calls: any[] = [];
  const begin = vi.fn(async (input: any) => {
    calls.push({ kind: "begin", input });
    return { sessionId: "sess", ...(options.ack ? { exactReplayProtocol: 1 } : {}) };
  });
  const imports = vi.fn(async (input: any) => {
    calls.push({ kind: "tables", input });
    const rows = input.rowsJson === undefined ? (input.rows ?? []) : JSON.parse(input.rowsJson);
    if (input.validateOnly && !options.ignoreValidation) {
      if (options.conflict && rows.length) throw Error("Existing row differs from this archive");
      counts[input.table] = (counts[input.table] ?? 0) + rows.length;
      return {
        inserted: 0,
        validated: true,
        validationComplete: !!input.validationComplete,
        validatedRows: counts[input.table],
      };
    }
    return { inserted: rows.length };
  });
  const abort = vi.fn(async () => ({ ok: true }));
  return {
    begin,
    imports,
    abort,
    calls,
    client: {
      dump: {
        importBegin: begin,
        importTables: imports,
        importCommit: async () => ({ ok: true, warnings: [] }),
        importAbort: abort,
      },
    } as unknown as BusabaseClient,
  };
}
describe("checksum-bound resume preflight", () => {
  it("requires capability before writing any row/object for new archives and all resumes", async () => {
    await archive();
    const old = target({ ack: false });
    await expect(runRestore(old.client, { file: path, json: true })).rejects.toThrow(
      /exactReplayProtocol/,
    );
    expect(old.imports).not.toHaveBeenCalled();
    expect(old.abort).toHaveBeenCalledOnce();
    const resumed = target({ ack: false });
    await expect(
      runRestore(resumed.client, { file: path, json: true, resume: true }),
    ).rejects.toThrow(/exactReplayProtocol/);
    expect(resumed.imports).not.toHaveBeenCalled();
    expect(resumed.abort).not.toHaveBeenCalled();
  });
  it("requires true read-only acknowledgement using an empty probe before non-empty rows", async () => {
    await archive();
    const broken = target({ ack: true, ignoreValidation: true });
    await expect(
      runRestore(broken.client, { file: path, json: true, resume: true }),
    ).rejects.toThrow(/acknowledge read-only/);
    expect(broken.imports).toHaveBeenCalledOnce();
    expect(broken.imports.mock.calls[0][0]).toMatchObject({
      table: "nodes",
      rowsJson: "[]",
      validateOnly: true,
    });
  });
  it("finishes all 35 table acknowledgements before any legacy blob/doc or SQL write", async () => {
    const manifest = await archive();
    const server = target();
    expect(await runRestore(server.client, { file: path, json: true, resume: true })).toMatchObject(
      { restored: true, warnings: [] },
    );
    expect(server.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceArchiveChecksum: manifest.checksum,
        preserveViewMetadata: true,
        expectedTables: expect.objectContaining({ nodes: 1, attachments: 1, workflowRuns: 0 }),
      }),
    );
    const sqlCalls = server.calls.filter((call) => call.kind === "tables");
    const firstWrite = sqlCalls.findIndex((call) => !call.input.validateOnly);
    expect(firstWrite).toBeGreaterThan(35);
    const ends = sqlCalls.slice(0, firstWrite).filter((call) => call.input.validationComplete);
    expect(ends.map((call) => call.input.table).sort()).toEqual([...IMPORT_ORDER].sort());
    expect(sqlCalls.slice(firstWrite).some((call) => call.input.table === "attachmentBlobs")).toBe(
      true,
    );
    expect(sqlCalls.slice(firstWrite).some((call) => call.input.table === "docBodies")).toBe(true);
  });
  it("stops a genuine SQL conflict before stored-object writes without rolling back earlier progress", async () => {
    await archive();
    const server = target({ ack: true, conflict: true });
    await expect(
      runRestore(server.client, { file: path, json: true, resume: true }),
    ).rejects.toThrow(/differs from this archive/);
    expect(
      server.calls
        .filter((call) => call.kind === "tables")
        .every((call) => call.input.validateOnly),
    ).toBe(true);
    expect(server.abort).not.toHaveBeenCalled();
  });
  it("still reads old v1/v2 archives with a legacy target for fresh restore", async () => {
    for (const version of [1, 2] as const) {
      await archive(version);
      const server = target({ ack: false });
      await expect(runRestore(server.client, { file: path, json: true })).resolves.toMatchObject({
        restored: true,
      });
    }
  });
});
