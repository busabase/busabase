import { once } from "node:events";
import { createServer } from "node:http";
import type { ExportSnapshotEventVO } from "busabase-contract/domains/dump/types";
import type { BusabaseDatabase } from "../../src/context";
import { runWithBusabaseContext } from "../../src/context";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseCommits,
  busabaseFieldValues,
  busabaseNodes,
  busabaseRecords,
} from "../../src/db/schema";
import {
  DUMP_IMPORT_ORDER,
  DUMP_TABLE_REGISTRY,
} from "../../src/domains/dump/logic/table-registry";
import { rootNodeIdForSpace } from "../../src/logic/kernel";
import { createBusabaseOpenApiHandler } from "../../src/openapi/handler";
import { busabaseRouter } from "../../src/router";
import { createDumpBusinessFixture } from "./dump-business-fixture";

export const snapshotEventRows = (
  event: Extract<ExportSnapshotEventVO, { type: "rows" }>,
): Record<string, unknown>[] => {
  const rows = JSON.parse(event.rowsJson);
  if (!Array.isArray(rows) || rows.length !== event.count)
    throw new Error("Invalid snapshot rowsJson/count");
  return rows;
};

export const seedSnapshotSpace = async (db: BusabaseDatabase, spaceId: string) => {
  const ids = {
    node: `${spaceId}-node`,
    base: `${spaceId}-base`,
    field: `${spaceId}-field`,
    commit: `${spaceId}-commit`,
    record: `${spaceId}-record`,
    cell: `${spaceId}-cell`,
  };
  await db
    .insert(busabaseNodes)
    .values({ id: ids.node, spaceId, parentId: null, type: "base", slug: "base", name: spaceId });
  await db
    .insert(busabaseBases)
    .values({ id: ids.base, spaceId, nodeId: ids.node, slug: "base", name: spaceId });
  await db.insert(busabaseBaseFields).values({
    id: ids.field,
    spaceId,
    baseId: ids.base,
    slug: "title",
    name: "Title",
    type: "text",
  });
  await db.insert(busabaseCommits).values({
    id: ids.commit,
    spaceId,
    baseId: ids.base,
    payload: { title: "before" },
    author: "snapshot-owner",
  });
  await db.insert(busabaseRecords).values({
    id: ids.record,
    spaceId,
    baseId: ids.base,
    headCommitId: ids.commit,
    createdBy: "snapshot-owner",
  });
  await db.insert(busabaseFieldValues).values({
    id: ids.cell,
    spaceId,
    baseId: ids.base,
    recordId: ids.record,
    commitId: ids.commit,
    fieldId: ids.field,
    fieldSlug: "title",
    fieldType: "text",
    valueText: "before",
  });
  return ids;
};

/** Every scoped table has a real FK-valid row in each tenant, including children. */
export const seedAllSnapshotTables = async (
  db: BusabaseDatabase,
  spaceId: string,
  prefix: string,
) => {
  const fixture = createDumpBusinessFixture(spaceId, prefix) as Record<
    string,
    Record<string, unknown>[]
  >;
  const node = `${prefix}_base_node`,
    base = `${prefix}_base`,
    commit = `${prefix}_commit`,
    request = `${prefix}_request`,
    operation = `${prefix}_operation`,
    record = `${prefix}_record`,
    field = `${prefix}_field`;
  fixture.nodes.unshift({
    id: rootNodeIdForSpace(spaceId),
    spaceId,
    parentId: null,
    type: "folder",
    slug: "root",
    name: spaceId,
  });
  fixture.nodePrincipals = [
    {
      id: `${prefix}_principal`,
      spaceId,
      nodeId: node,
      sourceNodeId: node,
      principalType: "user",
      principalId: "snapshot-owner",
      role: "manage",
      grantedBy: "snapshot-owner",
    },
  ];
  fixture.baseFields = [
    { id: field, spaceId, baseId: base, slug: "title", name: "Title", type: "text" },
  ];
  fixture.views = [
    {
      id: `${prefix}_view`,
      spaceId,
      baseId: base,
      slug: "grid",
      name: "Grid",
      createdBy: "snapshot-owner",
    },
  ];
  fixture.commits = [
    { id: commit, spaceId, baseId: base, payload: { title: prefix }, author: "snapshot-owner" },
  ];
  fixture.changeRequests = [{ id: request, spaceId, baseId: base, submittedBy: "snapshot-owner" }];
  fixture.operations = [
    {
      id: operation,
      spaceId,
      changeRequestId: request,
      baseId: base,
      operation: "record_create",
      headCommitId: commit,
    },
  ];
  fixture.records = [
    { id: record, spaceId, baseId: base, headCommitId: commit, createdBy: "snapshot-owner" },
  ];
  fixture.fieldValues = [
    {
      id: `${prefix}_cell`,
      spaceId,
      baseId: base,
      recordId: record,
      changeRequestId: request,
      operationId: operation,
      commitId: commit,
      fieldId: field,
      fieldSlug: "title",
      fieldType: "text",
      valueText: prefix,
    },
  ];
  fixture.recordLinks = [
    {
      id: `${prefix}_link`,
      spaceId,
      baseId: base,
      fieldId: field,
      fieldSlug: "title",
      sourceRecordId: record,
      targetBaseId: base,
      targetRecordId: record,
      commitId: commit,
    },
  ];
  fixture.attachments = [
    {
      id: `${prefix}_attachment`,
      spaceId,
      storageKey: `${prefix}/object`,
      fileName: "object.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      userId: "snapshot-owner",
    },
  ];
  fixture.assets = [
    {
      id: `${prefix}_asset`,
      spaceId,
      attachmentId: `${prefix}_attachment`,
      name: "Object",
      retainInLibrary: true,
    },
  ];
  fixture.assetUsages = [
    {
      id: `${prefix}_usage`,
      spaceId,
      assetId: `${prefix}_asset`,
      nodeId: `${prefix}_doc`,
      ownerType: "doc",
    },
  ];
  fixture.assetTexts = [
    {
      id: `${prefix}_text`,
      spaceId,
      assetId: `${prefix}_asset`,
      textStorageKey: `${prefix}/object`,
      writtenBy: "auto",
      status: "present",
      textContentHash: "sha256:" + "a".repeat(64),
    },
  ];
  fixture.reviews = [
    {
      id: `${prefix}_review`,
      spaceId,
      changeRequestId: request,
      reviewerId: "snapshot-owner",
      verdict: "approved",
    },
  ];
  fixture.auditEvents = [
    {
      id: `${prefix}_audit`,
      spaceId,
      action: "record.create",
      actorId: "snapshot-owner",
      baseId: base,
      recordId: record,
    },
  ];
  for (const table of DUMP_IMPORT_ORDER) {
    if (!fixture[table]?.length) throw new Error(`Snapshot fixture omitted ${table}`);
    await db.insert(DUMP_TABLE_REGISTRY[table] as never).values(fixture[table] as never);
  }
};

/** Real Node HTTP + the production OpenAPI handler, consumed after host ALS exits. */
export const snapshotHttpHost = async (db: BusabaseDatabase) => {
  const handler = createBusabaseOpenApiHandler(busabaseRouter);
  const errors: unknown[] = [];
  let origin = "";
  const server = createServer(async (request, response) => {
    const abort = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) abort.abort();
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers))
        if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const input = new Request(origin + request.url, {
        method: request.method,
        headers,
        signal: abort.signal,
        ...(chunks.length ? { body: Uint8Array.from(Buffer.concat(chunks)) } : {}),
      });
      const result = await runWithBusabaseContext(
        {
          db,
          spaceId: headers.get("x-busabase-space") ?? "snapshot-a",
          actorId: "snapshot-owner",
          isSpaceManager: headers.get("x-test-manager") !== "no",
        },
        () => handler.handle(input, { context: {} }),
      );
      if (!result.matched) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(result.response.status, Object.fromEntries(result.response.headers));
      reader = result.response.body?.getReader();
      if (reader)
        for (;;) {
          const next = await reader.read();
          if (next.done || response.destroyed) break;
          if (!response.write(Buffer.from(next.value)))
            await Promise.race([once(response, "drain"), once(response, "close")]);
        }
      if (!response.destroyed) response.end();
    } catch (error) {
      if (!abort.signal.aborted) errors.push(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    } finally {
      await reader?.cancel().catch(() => undefined);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No HTTP test address");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    errors,
    close: async () => {
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
};
