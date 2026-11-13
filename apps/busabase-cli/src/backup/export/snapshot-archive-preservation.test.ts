import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DumpTableSchema } from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import { afterEach, expect, it, vi } from "vitest";
import {
  drainEntry,
  readEntryText,
  streamArchive,
  verifyArchive,
} from "../format/archive-reader.js";
import { exportFull } from "./full-exporter.js";

const names = [...DumpTableSchema.options];
let directory: string;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("writes complete source rows for every table rather than its reduced in-memory index", async () => {
  const payload = JSON.parse(
    '{"__proto__":{"kept":true},"array":[3,null,{"unicode":"�🙂"}],"boolean":false}',
  );
  const body = Buffer.from("physical body");
  const date = "2026-11-11T01:02:03.123456Z";
  const rows: Record<string, Record<string, unknown>[]> = Object.fromEntries(
    names.map((table) => [
      table,
      [{ id: table, sourceFieldNotUsedByAnyIndex: payload, nullable: null, createdAt: date }],
    ]),
  );
  const assign = (table: string, values: Record<string, unknown>) =>
    Object.assign(rows[table][0], values);
  assign("nodes", {
    id: "nodes",
    parentId: null,
    type: "folder",
    slug: "root",
    name: "Root",
    metadata: payload,
    settings: payload,
    agentPrompts: [payload],
    icon: null,
    position: 9,
    updatedAt: date,
  });
  assign("bases", { nodeId: "nodes" });
  assign("baseFields", { baseId: "bases" });
  assign("views", { baseId: "bases", position: 0, config: payload });
  assign("nodePrincipals", { nodeId: "nodes", sourceNodeId: "nodes" });
  for (const table of ["nodeShares", "favorites", "nodeSubscriptions"])
    assign(table, { nodeId: "nodes" });
  for (const table of ["spaceInstructions", "spaceWelcome"]) {
    delete rows[table][0].id;
    assign(table, { spaceId: "local", body: payload });
  }
  assign("forms", { nodeId: "nodes", targetBaseId: "bases", bindings: [payload] });
  for (const table of ["commits", "changeRequests"])
    assign(table, { baseId: "bases", nodeId: "nodes", payload, status: "in_review" });
  assign("operations", {
    changeRequestId: "changeRequests",
    baseId: "bases",
    nodeId: "nodes",
    targetViewId: "views",
    mergedViewId: "views",
    headCommitId: "commits",
    payload,
  });
  assign("records", { baseId: "bases", headCommitId: "commits" });
  assign("fieldValues", {
    baseId: "bases",
    recordId: "records",
    fieldId: "baseFields",
    changeRequestId: "changeRequests",
    operationId: "operations",
    commitId: "commits",
    valueJson: payload,
  });
  assign("recordLinks", {
    baseId: "bases",
    fieldId: "baseFields",
    sourceRecordId: "records",
    targetBaseId: "bases",
    targetRecordId: "records",
    commitId: "commits",
  });
  assign("attachments", {
    storageKey: "attachments/body.bin",
    mimeType: "text/plain",
    fileName: "body.txt",
    sizeBytes: body.length,
    contentHash: createHash("sha256").update(body).digest("hex"),
    metadata: payload,
  });
  assign("assets", {
    attachmentId: "attachments",
    createdBy: "own",
    updatedAt: date,
    metadata: payload,
  });
  assign("assetUsages", { assetId: "assets", nodeId: "nodes" });
  assign("assetTexts", {
    assetId: "assets",
    status: "none",
    textStorageKey: "",
    textContentHash: null,
  });
  assign("comments", {
    recordId: "records",
    changeRequestId: "changeRequests",
    operationId: "operations",
    commitId: "commits",
    body: payload,
  });
  assign("commentMentions", { commentId: "comments" });
  assign("reviews", { changeRequestId: "changeRequests" });
  assign("auditEvents", {
    baseId: "bases",
    recordId: "records",
    changeRequestId: "changeRequests",
    operationId: "operations",
    commitId: "commits",
  });
  assign("agentSessions", { recoverySnapshot: payload });
  for (const table of ["agentSessionEvents", "agentSessionCommands"])
    assign(table, { sessionId: "agentSessions", payload });
  assign("routerConnections", { grantId: "routerGrants" });
  const columns = Object.fromEntries(names.map((table) => [table, Object.keys(rows[table][0])]));
  const counts = Object.fromEntries(names.map((table) => [table, 1]));
  const client = {
    dump: {
      exportSnapshot: async () =>
        (async function* () {
          yield {
            type: "start",
            version: 1,
            spaceId: "local",
            startedAt: date,
            tables: names,
            columns,
          };
          for (const table of names) {
            yield {
              type: "rows",
              table,
              rowsJson: JSON.stringify(rows[table]),
              count: rows[table].length,
            };
            yield { type: "tableEnd", table, count: 1 };
          }
          yield { type: "complete", tables: counts, attachmentDependencies: 0 };
        })(),
      exportDocBodies: async () => ({
        bodies: [],
        supportedRichNodeTypes: ["html", "whiteboard", "workflow"],
      }),
      exportAttachment: async () => ({
        attachmentId: "attachments",
        storageKey: "attachments/body.bin",
        downloadUrl: "http://fixture.invalid/body",
        mimeType: "text/plain",
        contentHash: rows.attachments[0].contentHash,
        sizeBytes: body.length,
      }),
      exportAssetText: async () => ({
        assetId: "assets",
        textStorageKey: "",
        downloadUrl: null,
        textContentHash: null,
        byteCount: 0,
      }),
    },
  } as unknown as BusabaseClient;
  vi.stubGlobal("fetch", async () => new Response(body));
  directory = await mkdtemp(join(tmpdir(), "snapshot-all-po-"));
  const archivePath = join(directory, "all.bbdump");
  const manifest = await exportFull({
    client,
    outPath: archivePath,
    sourceHost: "http://fixture.invalid",
    spaceId: "local",
    includeHistory: true,
    toolVersion: "test",
    retries: 0,
  });
  expect(manifest.sqlCapture?.mode).toBe("repeatable-read");
  expect(manifest.tables).toEqual(counts);
  await verifyArchive(archivePath);
  const actual: Record<string, unknown[]> = {};
  await streamArchive(archivePath, async (entry) => {
    const match = /^tree\/(\w+)\.ndjson$/.exec(entry.path);
    if (!match) {
      await drainEntry(entry.body);
      return;
    }
    actual[match[1]] = (await readEntryText(entry.body))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
  });
  expect(Object.keys(actual).sort()).toEqual([...names].sort());
  for (const table of names) expect(actual[table], table).toEqual(rows[table]);
});
