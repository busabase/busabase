import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DumpTableSchema } from "busabase-contract/domains/dump/types";
import { createBusabaseClient } from "busabase-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyArchive } from "../format/archive-reader.js";
import { ArchiveWriter } from "../format/archive-writer.js";
import { exportFull } from "./full-exporter.js";
import { withStrictSnapshotTransport } from "./snapshot-transport.js";

const tables = [...DumpTableSchema.options];
const node = { id: "nod_root", parentId: null, type: "folder" };
function valid() {
  const counts = Object.fromEntries(tables.map((t) => [t, t === "nodes" ? 1 : 0]));
  const columns = Object.fromEntries(
    tables.map((t) => [
      t,
      t === "nodes"
        ? Object.keys(node)
        : [t === "spaceInstructions" || t === "spaceWelcome" ? "spaceId" : "id"],
    ]),
  );
  const events: any[] = [
    {
      type: "start",
      version: 1,
      spaceId: "local",
      startedAt: "2026-11-11T00:00:00Z",
      tables,
      columns,
    },
  ];
  for (const table of tables) {
    if (table === "nodes")
      events.push({ type: "rows", table, rowsJson: JSON.stringify([node]), count: 1 });
    events.push({ type: "tableEnd", table, count: counts[table] });
  }
  events.push({ type: "complete", tables: counts, attachmentDependencies: 0 });
  return events;
}
const frame = (event: unknown) => `event: message\ndata: ${JSON.stringify(event)}\n\n`;
describe("snapshot wire failures preserve the previous published archive", () => {
  let dir: string, outPath: string;
  const servers: Server[] = [];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "snapshot-wire-"));
    outPath = join(dir, "space.bbdump");
    const writer = ArchiveWriter.create(outPath);
    await writer.finalize({
      formatVersion: 2,
      toolVersion: "old",
      exportedAt: "2026-11-11T00:00:00Z",
      spaceId: "local",
      sourceHost: "http://old.invalid",
      fidelity: "full",
      excludesSecrets: true,
      tables: {},
      blobCount: 0,
      blobBytes: 0,
      textBlobCount: 0,
      textBlobBytes: 0,
    });
  });
  afterEach(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    servers.length = 0;
    await rm(dir, { recursive: true, force: true });
  });
  async function fixture(mode: string) {
    let legacyRequests = 0;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (req.url === "/api/v1/dump/export/snapshot") {
        if (mode === "forbidden" || mode === "missing-route") {
          res.writeHead(mode === "forbidden" ? 403 : 404, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: mode === "forbidden" ? "Forbidden" : "Not found",
              code: mode === "forbidden" ? "FORBIDDEN" : "NOT_FOUND",
            }),
          );
          return;
        }
        const events = valid();
        if (mode === "missing-complete") events.pop();
        if (mode === "duplicate-tableEnd") events.splice(3, 0, events[2]);
        if (mode === "malformed-event")
          events[1] = {
            type: "rows",
            table: "nodes",
            rowsJson: JSON.stringify([{ ...node, unexpectedColumn: true }]),
            count: 1,
          };
        let text = events.map(frame).join("");
        if (mode === "incomplete-frame") text += 'event: message\ndata: {"unfinished":';
        else text += "event: done\ndata: null\n\n";
        if (mode === "after-done-tail") text += "unexpected-trailer";
        if (mode === "crlf") text = text.replaceAll("\n", "\r\n");
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(Buffer.from(text));
        if (mode === "invalid-utf8") res.write(Uint8Array.of(0xff));
        if (mode === "truncated-utf8") res.write(Uint8Array.of(0xe4, 0xb8));
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/api/v1/dump/export/tables") {
        legacyRequests++;
        res.end(JSON.stringify({ rows: input.table === "nodes" ? [node] : [], nextCursor: null }));
      } else
        res.end(
          JSON.stringify({
            bodies: [],
            supportedRichNodeTypes: ["html", "whiteboard", "workflow"],
          }),
        );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No listener");
    const origin = `http://127.0.0.1:${address.port}`;
    return {
      origin,
      client: createBusabaseClient({
        baseUrl: origin,
        apiKey: "",
        spaceId: "local",
        fetch: withStrictSnapshotTransport(fetch),
      }),
      legacyRequests: () => legacyRequests,
    };
  }
  it.each([
    "missing-complete",
    "duplicate-tableEnd",
    "malformed-event",
    "incomplete-frame",
    "after-done-tail",
    "invalid-utf8",
    "truncated-utf8",
    "forbidden",
  ])("rejects %s over actual HTTP without publishing or legacy fallback", async (mode) => {
    const old = await readFile(outPath);
    const host = await fixture(mode);
    await expect(
      exportFull({
        client: host.client,
        outPath,
        spaceId: "local",
        sourceHost: host.origin,
        includeHistory: true,
        toolVersion: "test",
        retries: 0,
      }),
    ).rejects.toThrow();
    expect(await readFile(outPath)).toEqual(old);
    expect((await verifyArchive(outPath)).toolVersion).toBe("old");
    expect(host.legacyRequests()).toBe(0);
    expect(
      (await readdir(dir)).filter(
        (name) => name.includes(".writing-") || name.includes(".tables-"),
      ),
    ).toEqual([]);
  });
  it("accepts legal CRLF and only falls back for an explicit missing endpoint", async () => {
    const host = await fixture("crlf");
    const result = await exportFull({
      client: host.client,
      outPath,
      spaceId: "local",
      sourceHost: host.origin,
      includeHistory: true,
      toolVersion: "new",
      retries: 0,
    });
    expect(result.sqlCapture?.mode).toBe("repeatable-read");
    expect(host.legacyRequests()).toBe(0);
    const old = await fixture("missing-route");
    const log = vi.fn();
    const fallback = await exportFull({
      client: old.client,
      outPath,
      spaceId: "local",
      sourceHost: old.origin,
      includeHistory: true,
      toolVersion: "fallback",
      retries: 0,
      onProgress: log,
    });
    expect(fallback.sqlCapture?.mode).toBe("legacy-paginated");
    expect(old.legacyRequests()).toBe(35);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("not a consistent"));
  });
});
