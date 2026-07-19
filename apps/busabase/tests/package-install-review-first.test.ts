import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The review-first install (no `--auto-merge`) against a REAL server.
 *
 * This is the path that used to lose data silently: `bases.create` without
 * autoMerge returns a PENDING change request and therefore no base id, so apply
 * bailed out — and the Base's records, the whole point of the package, were never
 * proposed at all. No error, no warning: you merged the change request and got an
 * empty Base. `package-roundtrip.test.ts` never caught it because it installs with
 * `--auto-merge`.
 *
 * The fixture is deliberately relation-free: a package whose Bases carry relation
 * fields legitimately refuses to install review-first (a relation stores the ids of
 * records that don't exist until they're merged), so it could not exercise this.
 */

const BASE_URL = "http://localhost:15419";
const REPO_URL = "https://github.com/acme/review-first-package";

type GlobalWithBusabaseState = typeof globalThis & {
  __busabaseCoreDbState?: {
    db: unknown | null;
    client: unknown | null;
    initPromise: Promise<unknown> | null;
  };
  __busabaseReadyBySpace?: Map<string, Promise<void>>;
};

const zipDirectory = async (dir: string, archiveRoot: string): Promise<Buffer> => {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(current)).sort()) {
      const abs = path.join(current, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if ((await stat(abs)).isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      const bytes = await readFile(abs);
      await writer.add(`${archiveRoot}/${rel}`, new BlobReader(new Blob([new Uint8Array(bytes)])));
    }
  };
  await walk(dir, "");
  return Buffer.from(await (await writer.close()).arrayBuffer());
};

describe("busabase-cli install without --auto-merge (real server)", () => {
  const dirs: string[] = [];
  let outDir = "";
  let zipball: Buffer = Buffer.alloc(0);
  let currentStorageDir = "";
  const originalFetch = global.fetch;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ["BUSABASE_API_KEY", "BUSABASE_BASE_URL", "BUSABASE_SPACE_ID", "HOME"] as const;

  let liveRecordCount = 0;
  let pendingRecordOps = 0;
  let installedBaseSlugs: string[] = [];

  const mkTmp = async (label: string): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), `busabase-rf-${label}-`));
    dirs.push(dir);
    return dir;
  };

  const routerClient = async () => {
    const { createRouterClient } = await import("@orpc/server");
    const { busabaseRouter } = await import("busabase-core/router");
    return createRouterClient(busabaseRouter);
  };

  const cli = async (...args: string[]): Promise<unknown> => {
    const { runCli } = await import("busabase-cli");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const exitCode = await runCli(["--base-url", BASE_URL, "--output", "json", ...args]);
      if (exitCode !== 0) {
        const stderr = err.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
        throw new Error(`busabase-cli ${args.join(" ")} exited ${exitCode}\n${stderr}`);
      }
      const last = log.mock.calls.at(-1)?.[0];
      return typeof last === "string" ? JSON.parse(last) : last;
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  };

  const useDatabase = async (dbDir: string, storageDir: string): Promise<void> => {
    currentStorageDir = storageDir;
    const g = globalThis as GlobalWithBusabaseState;
    if (g.__busabaseCoreDbState) {
      const prev = g.__busabaseCoreDbState.client as { close?: () => Promise<void> } | null;
      if (prev && typeof prev.close === "function") await prev.close();
      g.__busabaseCoreDbState = { db: null, client: null, initPromise: null };
    }
    if (g.__busabaseReadyBySpace) g.__busabaseReadyBySpace = new Map();
    process.env.PG_DATABASE_URL = `pglite://${dbDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const { resetStorage } = await import("openlib/storage");
    resetStorage();
  };

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.HOME = await mkTmp("home");
    delete process.env.BUSABASE_API_KEY;
    delete process.env.BUSABASE_BASE_URL;
    delete process.env.BUSABASE_SPACE_ID;
    outDir = await mkTmp("out");

    // ── Source: a minimal, relation-free package ─────────────────────────────
    await useDatabase(await mkTmp("src-db"), await mkTmp("src-st"));
    const { busabaseRouter } = await import("busabase-core/router");
    const handler = new OpenAPIHandler(busabaseRouter);
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.hostname === "codeload.github.com") {
        return new Response(new Uint8Array(zipball), { status: 200 });
      }
      if (url.pathname.startsWith("/api/test/storage/")) {
        const key = decodeURIComponent(url.pathname.slice("/api/test/storage/".length));
        try {
          return new Response(new Uint8Array(await readFile(path.join(currentStorageDir, key))), {
            status: 200,
          });
        } catch {
          return new Response("not found", { status: 404 });
        }
      }
      if (!url.pathname.startsWith("/api/")) return originalFetch(input as RequestInfo, init);
      const result = await handler.handle(request, { context: {} });
      return result.matched ? result.response : Response.json({ error: "nf" }, { status: 404 });
    }) as typeof fetch;

    const client = await routerClient();
    const folder = await client.nodes.createChangeRequest({
      message: "Add the source folder",
      autoMerge: true,
      operations: [
        { kind: "create", nodeType: "folder", slug: "kb", name: "KB", description: "A tiny KB." },
      ],
    });
    const parentNodeId = folder.operations[0]?.nodeId as string;
    const base = await client.bases.create({
      parentNodeId,
      slug: "articles",
      name: "Articles",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "body", name: "Body", type: "longtext", required: false },
      ],
      autoMerge: true,
    });
    const baseId = (base as { id: string }).id;
    for (const title of ["First article", "Second article"]) {
      const cr = await client.bases.createChangeRequest({
        baseId,
        fields: { title, body: `Body of ${title}` },
        submittedBy: "fixture",
      });
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: cr.id });
    }

    await cli("publish", "kb", "-o", outDir);
    zipball = await zipDirectory(outDir, "review-first-package-main");

    // ── Target: a fresh, empty database; install WITHOUT --auto-merge ────────
    await useDatabase(await mkTmp("tgt-db"), await mkTmp("tgt-st"));
    await cli("install", REPO_URL);

    const target = await routerClient();
    installedBaseSlugs = (await target.bases.list()).map((b) => b.slug);
    // Live (merged) records in the whole target space.
    let cursor: string | undefined;
    do {
      const page = await target.dump.exportTables({ table: "records", cursor, limit: 500 });
      liveRecordCount += page.rows.length;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    // Records proposed but awaiting review. `changeRequests.list` takes only `limit`,
    // so filter by status here.
    const all = (await target.changeRequests.list({ limit: 100 })) as Array<{
      status: string;
      operations?: Array<{ operation: string }>;
    }>;
    pendingRecordOps = all
      .filter((cr) => cr.status === "in_review")
      .reduce(
        (sum, cr) =>
          sum + (cr.operations ?? []).filter((op) => op.operation === "record_create").length,
        0,
      );
  }, 300_000);

  afterAll(async () => {
    global.fetch = originalFetch;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it("creates the Base itself — structure is not something you review", () => {
    expect(installedBaseSlugs).toContain("articles");
  });

  it("proposes the records for review instead of dropping them (the regression)", () => {
    // The bug: this was 0. The records were never proposed, and merging the Base's
    // change request left you with an empty Base and no indication anything was lost.
    expect(pendingRecordOps).toBe(2);
  });

  it("leaves nothing live until the reviewer merges — that is the whole promise", () => {
    expect(liveRecordCount).toBe(0);
  });
});
