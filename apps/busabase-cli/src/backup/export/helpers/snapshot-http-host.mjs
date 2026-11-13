/** Isolated real-PGlite/oRPC HTTP fixture, never used by production commands. */

import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { runWithBusabaseContext } from "busabase-core/context";
import { getDb } from "busabase-core/db";
import { busabaseRouter } from "busabase-core/router";
import { sql } from "drizzle-orm";
import { storage } from "openlib/storage";
import {
  attachments,
  busabaseAssets,
  busabaseBaseFields,
  busabaseBases,
  busabaseCommits,
  busabaseFieldValues,
  busabaseNodes,
  busabaseRecords,
} from "../../../../../../packages/busabase-core/src/db/schema.ts";
import {
  docBodyKey,
  writeDocBody,
} from "../../../../../../packages/busabase-core/src/domains/doc/handlers.ts";
import { ensureReady } from "../../../../../../packages/busabase-core/src/logic/seed.ts";

const role = process.env.SNAPSHOT_FIXTURE_ROLE;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (work) =>
  runWithBusabaseContext({ spaceId: "local", actorId: "fixture-user", isSpaceManager: true }, work);
const api = new OpenAPIHandler(busabaseRouter);
let origin = "";
let failBlob = false;
const server = createServer(async (req, res) => {
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === "/fixture/control") {
      const body = JSON.parse(await new Response(Readable.toWeb(req)).text());
      failBlob = Boolean(body.failBlob);
      if (body.mutableContent !== undefined)
        await storage.uploadFileToKey(
          Buffer.from(body.mutableContent),
          "attachments/mutable.txt",
          "text/plain",
        );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/fixture/inspect") {
      const db = await getDb();
      const nodes = await db.select().from(busabaseNodes);
      const ats = await db.select().from(attachments);
      const assets = await db.select().from(busabaseAssets);
      const times = await db.execute(
        sql`SELECT id, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt", to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt" FROM busabase_nodes ORDER BY id`,
      );
      const commits = await db.execute(
        sql`SELECT id, octet_length(payload::text) AS bytes, payload->>'large' AS "large" FROM busabase_commits WHERE id='cmt_large'`,
      );
      const rawCommits = commits.rows ?? commits;
      // SQL text casts expose JSONB values without any RPC serializer/projector.
      const nodeJson = await db.execute(
        sql`SELECT id, metadata::text AS "metadataText", settings::text AS "settingsText", agent_prompts::text AS "agentPromptsText" FROM busabase_nodes WHERE id IN ('nod_root','nod_fixture_doc') ORDER BY id`,
      );
      const commitJson = await db.execute(
        sql`SELECT id, payload::text AS "payloadText" FROM busabase_commits WHERE id='cmt_fixture_opaque' ORDER BY id`,
      );
      const cellJson = await db.execute(
        sql`SELECT id, value_json::text AS "valueJsonText", jsonb_typeof(value_json) AS "jsonType" FROM busabase_field_values ORDER BY id`,
      );

      const blobs = [];
      for (const row of ats) {
        let bytes;
        try {
          bytes = await storage.getObject(row.storageKey);
        } catch {}
        blobs.push({ key: row.storageKey, sha256: bytes ? hash(bytes) : null });
      }
      let doc;
      try {
        doc = hash(await storage.getObject(docBodyKey("nod_fixture_doc")));
      } catch {}
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          nodes,
          attachments: ats,
          assets,
          times: times.rows ?? times,
          docSha256: doc,
          blobs,
          opaqueProof: {
            nodes: nodeJson.rows ?? nodeJson,
            commits: commitJson.rows ?? commitJson,
            cells: cellJson.rows ?? cellJson,
          },
          commits: rawCommits.map((row) => ({
            id: row.id,
            bytes: row.bytes,
            largeSha256: row.large ? hash(row.large) : null,
          })),
        }),
      );
      return;
    }
    if (url.pathname.startsWith("/files/")) {
      const key = url.pathname.slice("/files/".length).split("/").map(decodeURIComponent).join("/");
      if (failBlob && key === "attachments/z-fail.txt") {
        res.writeHead(503);
        res.end("fixture retryable download failure");
        return;
      }
      const body = await storage.getObject(key);
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(body);
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (value) headers.set(name, Array.isArray(value) ? value.join(",") : value);
    const input = new Request(url, {
      method: req.method,
      headers,
      signal: abort.signal,
      ...(req.method !== "GET" && req.method !== "HEAD"
        ? { body: Readable.toWeb(req), duplex: "half" }
        : {}),
    });
    const handled = await run(() => api.handle(input, { context: {} }));
    if (!handled.matched) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found", code: "NOT_FOUND" }));
      return;
    }
    res.writeHead(handled.response.status, Object.fromEntries(handled.response.headers));
    if (handled.response.body)
      for await (const chunk of Readable.fromWeb(handled.response.body)) {
        if (!res.write(chunk)) await once(res, "drain");
      }
    res.end();
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
process.env.STORAGE_URL = `local:${process.env.SNAPSHOT_FIXTURE_STORAGE}?base_url=${encodeURIComponent(`${origin}/files`)}`;
await run(async () => {
  await ensureReady();
  const db = await getDb();
  if (role === "source") {
    await db.insert(busabaseNodes).values({
      id: "nod_fixture_doc",
      spaceId: "local",
      parentId: "nod_root",
      type: "doc",
      slug: "fixture-doc",
      name: "Snapshot Unicode �🙂",
    });
    await db.execute(
      sql`UPDATE busabase_nodes SET created_at='2026-11-11T01:02:03.123456Z'::timestamp,updated_at='2026-11-11T04:05:06.654321Z'::timestamp WHERE id='nod_fixture_doc'`,
    );
    await writeDocBody("nod_fixture_doc", "# Preserved �🙂\n");
    const opaque = JSON.parse(
      '{"__proto__":{"literal":"own-key","constructor":"nested-constructor","toJSON":"nested-toJSON"},"constructor":{"kept":true},"toJSON":{"literal":true},"array":[{"__proto__":null,"constructor":0,"toJSON":"array-key"},[2,1],null,"[1,2]"],"scalarString":"[1,2]","replacement":"�🙂"}',
    );
    await db.execute(
      sql`UPDATE busabase_nodes SET metadata=${JSON.stringify(opaque)}::jsonb,settings=${JSON.stringify(opaque)}::jsonb,agent_prompts=${JSON.stringify([opaque, "[1,2]"])}::jsonb WHERE id IN ('nod_root','nod_fixture_doc')`,
    );
    await db.insert(busabaseNodes).values({
      id: "nod_fixture_base",
      spaceId: "local",
      parentId: "nod_root",
      type: "base",
      slug: "fixture-opaque-base",
      name: "Opaque JSON base",
    });
    await db.insert(busabaseBases).values({
      id: "base_fixture_opaque",
      spaceId: "local",
      nodeId: "nod_fixture_base",
      slug: "fixture-opaque-base",
      name: "Opaque JSON base",
    });
    await db.insert(busabaseBaseFields).values({
      id: "field_fixture_opaque",
      spaceId: "local",
      baseId: "base_fixture_opaque",
      slug: "json-value",
      name: "Original JSON",
      type: "json",
    });
    await db.insert(busabaseCommits).values({
      id: "cmt_fixture_opaque",
      spaceId: "local",
      baseId: "base_fixture_opaque",
      operation: "record_create",
      payload: opaque,
      author: "fixture-user",
    });
    await db.insert(busabaseRecords).values({
      id: "rec_fixture_opaque",
      spaceId: "local",
      baseId: "base_fixture_opaque",
      headCommitId: "cmt_fixture_opaque",
      createdBy: "fixture-user",
    });
    for (const [index, valueJson] of [
      opaque,
      "[1,2]",
      '[{"__proto__":true}]',
      [1, 2],
      false,
      0,
      null,
    ].entries())
      await db.insert(busabaseFieldValues).values({
        id: `fv_fixture_opaque_${index}`,
        spaceId: "local",
        baseId: "base_fixture_opaque",
        recordId: "rec_fixture_opaque",
        commitId: "cmt_fixture_opaque",
        fieldId: "field_fixture_opaque",
        fieldSlug: "json-value",
        fieldType: "json",
        valueJson,
      });

    const body = Buffer.from("foreign-visible-content");
    await db.insert(attachments).values({
      id: "att_foreign",
      spaceId: "foreign-space",
      userId: "foreign-owner-never-export",
      storageKey: "attachments/foreign.txt",
      fileName: "visible.txt",
      mimeType: "text/plain",
      sizeBytes: body.length,
      contentHash: `sha256:${hash(body)}`,
      context: "foreign-secret-context",
      metadata: { secret: "foreign-metadata-never-export" },
    });
    await db.insert(busabaseAssets).values({
      id: "ast_own_foreign",
      spaceId: "local",
      createdBy: "fixture-user",
      attachmentId: "att_foreign",
      name: "Readable dependency",
    });
    await storage.uploadFileToKey(body, "attachments/foreign.txt", "text/plain");
    for (const [id, key, text] of [
      ["att_mutable", "attachments/mutable.txt", "old-data"],
      ["att_z_fail", "attachments/z-fail.txt", "always-ok"],
    ]) {
      await db.insert(attachments).values({
        id,
        spaceId: "local",
        userId: "fixture-user",
        storageKey: key,
        fileName: "fixture.txt",
        mimeType: "text/plain",
        sizeBytes: Buffer.byteLength(text),
        contentHash: id === "att_mutable" ? null : `sha256:${hash(text)}`,
      });
      await storage.uploadFileToKey(Buffer.from(text), key, "text/plain");
    }
    const size = Number(process.env.SNAPSHOT_FIXTURE_BIG_BYTES ?? 0);
    if (size) {
      const large = `${"x".repeat(size - 8)}�🙂`;
      await db.insert(busabaseCommits).values({
        id: "cmt_large",
        spaceId: "local",
        nodeId: "nod_fixture_doc",
        operation: "doc_update",
        payload: { large },
        author: "fixture-user",
      });
    }
  } else if (role === "conflict") {
    await db.insert(attachments).values({
      id: "att_collision",
      spaceId: "foreign-space",
      userId: "foreign-owner",
      storageKey: "attachments/foreign.txt",
      fileName: "untouched.txt",
      mimeType: "text/plain",
      sizeBytes: 9,
    });
    await storage.uploadFileToKey(
      Buffer.from("untouched"),
      "attachments/foreign.txt",
      "text/plain",
    );
  }
});
console.log(`SNAPSHOT_HTTP_READY ${JSON.stringify({ origin, role })}`);
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
});
