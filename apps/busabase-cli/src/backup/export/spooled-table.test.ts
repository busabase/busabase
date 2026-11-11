import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BusabaseClient } from "busabase-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drainEntry, streamArchive, verifyArchive } from "../format/archive-reader.js";
import { streamNdjsonRows } from "../import/full-importer.js";
import { exportFull } from "./full-exporter.js";
import { SpooledTable } from "./spooled-table.js";

type Row = Record<string, unknown>;
const run = promisify(execFile);
const baseTables = (): Record<string, Row[]> => ({
  nodes: [{ id: "node-root", parentId: null, type: "folder" }],
  bases: [{ id: "base", nodeId: "node-root" }],
  records: [{ id: "record", baseId: "base", headCommitId: "commit" }],
  commits: [{ id: "commit" }],
});
const fieldValue = (id: string, extra: Row = {}): Row => ({
  id,
  baseId: "base",
  recordId: "record",
  commitId: "commit",
  changeRequestId: null,
  operationId: null,
  ...extra,
});

async function readTable(path: string, table: string): Promise<Row[]> {
  const rows: Row[] = [];
  await streamArchive(path, async (entry) => {
    if (entry.path === `tree/${table}.ndjson`) {
      await streamNdjsonRows(entry.body, async (batch) => {
        rows.push(...batch);
      });
    } else await drainEntry(entry.body);
  });
  return rows;
}

const readFieldValues = (path: string) => readTable(path, "fieldValues");

const clientFor = (
  tables: Record<string, Row[]>,
  beforePage?: (table: string, start: number) => void,
): BusabaseClient =>
  ({
    dump: {
      exportDocBodies: async () => ({ bodies: [] }),
      exportTables: async ({ table, cursor }: { table: string; cursor?: string }) => {
        const start = Number(cursor ?? 0);
        beforePage?.(table, start);
        const rows = tables[table] ?? [];
        const page = rows.slice(start, start + 2);
        return {
          rows: page,
          nextCursor: start + page.length < rows.length ? String(start + page.length) : null,
        };
      },
    },
  }) as unknown as BusabaseClient;

describe("full backup fieldValues stays bounded by a page", () => {
  let directory: string;
  let archivePath: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "busabase-field-values-spool-"));
    archivePath = join(directory, "space.bbdump");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const options = (client: BusabaseClient, outPath: string) => ({
    client,
    outPath,
    spaceId: "source",
    sourceHost: "http://source.invalid",
    includeHistory: true,
    toolVersion: "test",
    retries: 0,
  });
  const transientSpools = async () =>
    (await readdir(directory)).filter((name) => name.startsWith(".space.bbdump.tables-"));

  it("preserves valid row bytes and order across pages without retaining their payloads", async () => {
    const tables = baseTables();
    tables.fieldValues = [
      fieldValue("one", { valueText: "你好\n世界" }),
      fieldValue("two", { recordId: null, valueText: "A".repeat(80_000) }),
    ];
    const manifest = await exportFull(options(clientFor(tables), archivePath));
    expect(manifest.tables.fieldValues).toBe(2);
    expect(await readFieldValues(archivePath)).toEqual(tables.fieldValues);
    await expect(verifyArchive(archivePath)).resolves.toEqual(manifest);
    expect(await transientSpools()).toEqual([]);
  });

  it.each([
    { recordId: "missing" },
    { commitId: "missing" },
    { baseId: "missing" },
    { changeRequestId: "missing" },
    { operationId: "missing" },
  ])("fails closed on a spooled row with an unresolved reference %j", async (broken) => {
    const tables = baseTables();
    tables.fieldValues = [fieldValue("valid"), fieldValue("broken", broken)];
    await expect(exportFull(options(clientFor(tables), archivePath))).rejects.toThrow(
      /fieldValues row broken.*missing/,
    );
    expect(await transientSpools()).toEqual([]);
    await expect(verifyArchive(archivePath)).rejects.toThrow();
  });

  it("rejects a broken parent instead of cascading silent row pruning", async () => {
    const tables = baseTables();
    tables.records.push({ id: "broken-record", baseId: "base", headCommitId: "missing" });
    tables.fieldValues = [fieldValue("child", { recordId: "broken-record" })];
    await expect(exportFull(options(clientFor(tables), archivePath))).rejects.toThrow(
      /records row broken-record.*missing commits/,
    );
    expect(await transientSpools()).toEqual([]);
  });

  it("retries a failed page without duplicates and re-fetches table rows on --resume", async () => {
    const tables = baseTables();
    tables.fieldValues = [fieldValue("one"), fieldValue("two"), fieldValue("three")];
    let failed = false;
    const cursors: number[] = [];
    const client = clientFor(tables, (table, start) => {
      if (table !== "fieldValues") return;
      cursors.push(start);
      if (start === 2 && !failed) {
        failed = true;
        throw new Error("page interrupted");
      }
    });
    await exportFull({ ...options(client, archivePath), retries: 1 });
    expect(cursors).toEqual([0, 2, 2]);
    expect(await readFieldValues(archivePath)).toEqual(tables.fieldValues);
    tables.fieldValues = [fieldValue("new-attempt")];
    await exportFull({ ...options(clientFor(tables), archivePath), resume: true });
    expect(await readFieldValues(archivePath)).toEqual(tables.fieldValues);
    expect(await transientSpools()).toEqual([]);
  });

  it("prunes commit payloads by surviving current and unfinished work without changing loose parent ids", async () => {
    const tables = baseTables();
    tables.commits = [
      { id: "old", parentCommitId: null, payload: { text: "old" } },
      { id: "commit", parentCommitId: "old", payload: { text: "current\r\n正文" } },
      { id: "open-commit", parentCommitId: "old", payload: { text: "unfinished" } },
      { id: "finished-commit", parentCommitId: "old", payload: { text: "finished" } },
    ];
    tables.changeRequests = [
      { id: "open", status: "in_review" },
      { id: "finished", status: "merged" },
    ];
    tables.operations = [
      { id: "open-op", changeRequestId: "open", headCommitId: "open-commit" },
      { id: "finished-op", changeRequestId: "finished", headCommitId: "finished-commit" },
    ];
    tables.fieldValues = [
      fieldValue("current", { changeRequestId: "finished", operationId: "finished-op" }),
      fieldValue("unfinished", {
        recordId: null,
        changeRequestId: "open",
        operationId: "open-op",
        commitId: "open-commit",
      }),
      fieldValue("finished", {
        recordId: null,
        changeRequestId: "finished",
        operationId: "finished-op",
        commitId: "finished-commit",
      }),
    ];
    const full = await exportFull(options(clientFor(tables), archivePath));
    expect(full.tables.commits).toBe(4);
    expect(await readTable(archivePath, "commits")).toEqual(tables.commits);
    const current = await exportFull({
      ...options(clientFor(tables), archivePath),
      includeHistory: false,
    });
    expect(current.tables.commits).toBe(2);
    expect(await readTable(archivePath, "commits")).toEqual([tables.commits[1], tables.commits[2]]);
    expect(await readFieldValues(archivePath)).toEqual([
      { ...tables.fieldValues[0], changeRequestId: null, operationId: null },
      tables.fieldValues[1],
    ]);
    await expect(verifyArchive(archivePath)).resolves.toEqual(current);
    expect(await transientSpools()).toEqual([]);
  });

  it("removes transient table data if a later table fetch fails", async () => {
    const tables = baseTables();
    tables.fieldValues = [fieldValue("one")];
    const client = clientFor(tables, (table) => {
      if (table === "auditEvents") throw new Error("later page unavailable");
    });
    await expect(exportFull(options(client, archivePath))).rejects.toThrow(
      "later page unavailable",
    );
    expect(await transientSpools()).toEqual([]);
  });

  it("streams workflow outputs and agent transcripts while checking their parent sessions", async () => {
    const tables = baseTables();
    const payload = { text: "多字节正文\r\n".repeat(8192), nested: { list: [1, null, "�"] } };
    tables.agentSessions = [{ id: "session", recoverySnapshot: payload }];
    tables.agentSessionEvents = Array.from({ length: 5 }, (_, seq) => ({
      id: `event-${seq}`,
      sessionId: "session",
      seq,
      payload,
    }));
    tables.agentSessionCommands = [{ id: "command", sessionId: "session", payload }];
    tables.workflowRuns = [{ id: "run", outputs: payload }];
    tables.webhookDeliveries = [{ id: "delivery", detail: payload.text }];
    const manifest = await exportFull(options(clientFor(tables), archivePath));
    for (const table of [
      "agentSessions",
      "agentSessionEvents",
      "agentSessionCommands",
      "workflowRuns",
      "webhookDeliveries",
    ])
      expect(await readTable(archivePath, table)).toEqual(tables[table]);
    expect(manifest.tables.agentSessionEvents).toBe(5);
    expect(await transientSpools()).toEqual([]);
    tables.agentSessionEvents[0].sessionId = "missing-session";
    await expect(exportFull(options(clientFor(tables), archivePath))).rejects.toThrow(
      /agentSessionEvents.*missing agentSessions.*sessionId/,
    );
    // The previous complete archive remains readable after the failed replacement.
    expect(await verifyArchive(archivePath)).toEqual(manifest);
  });

  it("prunes mentions with their intentionally removed comments under --no-history", async () => {
    const tables = baseTables();
    tables.changeRequests = [{ id: "finished", status: "merged" }];
    tables.comments = [
      { id: "kept", recordId: "record", changeRequestId: null },
      { id: "removed", changeRequestId: "finished" },
    ];
    tables.commentMentions = [
      { id: "mention-kept", commentId: "kept", label: "Agent" },
      { id: "mention-removed", commentId: "removed", label: "Member" },
    ];
    const manifest = await exportFull({
      ...options(clientFor(tables), archivePath),
      includeHistory: false,
    });
    expect(manifest.tables.commentMentions).toBe(1);
    expect(await readTable(archivePath, "commentMentions")).toEqual([tables.commentMentions[0]]);
  });

  it("rejects malformed rows and cleans up instead of archiving them as missing references", async () => {
    const tables = baseTables();
    tables.fieldValues = [null as unknown as Row];
    await expect(exportFull(options(clientFor(tables), archivePath))).rejects.toThrow(
      "non-object row",
    );
    expect(await transientSpools()).toEqual([]);
  });

  it("rejects a corrupt complete spool line and still releases its files", async () => {
    const spool = await SpooledTable.create(archivePath);
    try {
      await spool.append([fieldValue("one")]);
      const [name] = await transientSpools();
      await writeFile(join(directory, name, "raw.ndjson"), "{broken JSON}\n");
      await expect(spool.filter(() => true)).rejects.toThrow("invalid JSON in table spool row 1");
    } finally {
      await spool.cleanup();
    }
    expect(await transientSpools()).toEqual([]);
  });

  it("closes and removes table data after filter and archive consumer failures", async () => {
    const first = await SpooledTable.create(archivePath);
    try {
      await first.append([fieldValue("one")]);
      await expect(
        first.filter(() => {
          throw new Error("filter failed");
        }),
      ).rejects.toThrow("filter failed");
    } finally {
      await first.cleanup();
    }
    expect(await transientSpools()).toEqual([]);
    const second = await SpooledTable.create(archivePath);
    try {
      await second.append([fieldValue("one")]);
      await second.filter(() => true);
      await expect(
        second.writeArchive(
          {
            addStream: async () => {
              throw new Error("archive write failed");
            },
          },
          "tree/fieldValues.ndjson",
        ),
      ).rejects.toThrow("archive write failed");
    } finally {
      await second.cleanup();
    }
    expect(await transientSpools()).toEqual([]);
  });

  it.each([true, false])(
    "backs up and verifies 128,000 large commits and field rows in a 96MB heap (includeHistory=%s)",
    async (includeHistory) => {
      const fixture = join(directory, "low-heap.mjs");
      const exporter = new URL("./full-exporter.ts", import.meta.url).href;
      const reader = new URL("../format/archive-reader.ts", import.meta.url).href;
      const importer = new URL("../import/full-importer.ts", import.meta.url).href;
      await writeFile(
        fixture,
        `
import { exportFull } from ${JSON.stringify(exporter)};
import { verifyArchive, streamArchive, drainEntry } from ${JSON.stringify(reader)};
import { streamNdjsonRows } from ${JSON.stringify(importer)};
import { readdir } from 'node:fs/promises';
const outPath=process.argv[2], total=128000;
const small=${JSON.stringify(baseTables())};small.records[0].headCommitId='cmt-0';
const value=(index)=>String(index).padEnd(2048,'x');
const client={dump:{exportTables:async({table,cursor,limit})=>{
 if(table!=='fieldValues'&&table!=='commits')return {rows:small[table]??[],nextCursor:null};
 const start=Number(cursor??0),end=Math.min(total,start+limit);
 // A real response JSON-decoder allocates independent strings for every row;
 // do likewise instead of sharing one payload string between fake records.
 const rows=JSON.parse(JSON.stringify(Array.from({length:end-start},(_,i)=>table==='fieldValues'?({id:'fv-'+(start+i),baseId:'base',recordId:'record',commitId:'cmt-'+(start+i),valueText:value(start+i)}):({id:'cmt-'+(start+i),parentCommitId:start+i===0?null:'cmt-'+(start+i-1),payload:{text:value(start+i)}}))));
 return {rows,nextCursor:end<total?String(end):null};
},exportDocBodies:async()=>({bodies:[]})}};
const manifest=await exportFull({client,outPath,spaceId:'source',sourceHost:'http://source.invalid',includeHistory:${includeHistory},toolVersion:'test',retries:0,pageLimit:1000});
await verifyArchive(outPath);let checked=0,commitsChecked=0;
await streamArchive(outPath,async(entry)=>{
 if(entry.path==='tree/commits.ndjson'){await streamNdjsonRows(entry.body,async(rows)=>{for(const row of rows){if(row.id!=='cmt-'+commitsChecked||row.payload.text!==value(commitsChecked)||row.parentCommitId!==(commitsChecked===0?null:'cmt-'+(commitsChecked-1)))throw Error('commit loss or payload mismatch');commitsChecked++;}});return;}
 if(entry.path!=='tree/fieldValues.ndjson'){await drainEntry(entry.body);return;}
 await streamNdjsonRows(entry.body,async(rows)=>{for(const row of rows){if(row.id!=='fv-'+checked||row.valueText!==value(checked))throw Error('row loss or byte mismatch');checked++;}});
});
if(checked!==total||commitsChecked!==total||manifest.tables.fieldValues!==total||manifest.tables.commits!==total)throw Error('row count mismatch');
console.log(JSON.stringify({checked,commitsChecked,rows:manifest.tables.fieldValues,heapLimitMB:96,spools:(await readdir(new URL('.', 'file://'+outPath))).filter(x=>x.startsWith('.space.bbdump.tables-')).length}));
`,
      );
      const result = await run(
        process.execPath,
        ["--max-old-space-size=96", "--import", import.meta.resolve("tsx"), fixture, archivePath],
        { timeout: 90_000, maxBuffer: 1024 * 1024 },
      );
      expect(JSON.parse(result.stdout.trim())).toEqual({
        checked: 128_000,
        commitsChecked: 128_000,
        rows: 128_000,
        heapLimitMB: 96,
        spools: 0,
      });
    },
    95_000,
  );
});
