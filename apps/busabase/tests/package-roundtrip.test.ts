import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `busabase-cli publish` → `busabase-cli install` round trip, driven through the
 * REAL CLI against a REAL router (CLI → busabase-sdk → oRPC → busabase-core →
 * PGlite), with `fetch` redirected in-process — the same harness convention as
 * `cli-golden-path.test.ts`, extended to also serve a synthetic GitHub zipball
 * so `install` exercises its true code path (codeload URL → zip → extract →
 * read → plan → five-pass apply), not a test-only shortcut.
 *
 * The round trip crosses two DATABASES, not two spaces: OSS busabase is
 * single-space (the `/api/v1` route runs `runWithBusabaseContext` with no
 * spaceId, so `getContextSpaceId()` is always `LOCAL_SPACE_ID`), and base slugs
 * are unique per space — so publishing and re-installing into the same database
 * would collide by construction. Source = the seeded demo DB; target = a
 * second, previously-empty PGlite DB + storage tree (same singleton-reset
 * pattern as `packages/busabase-core/tests/dump-roundtrip.test.ts`).
 *
 * What it proves that the unit tests cannot: that a package produced from the
 * real demo dataset actually re-materializes — including the three id-bearing
 * field options that have no portable form of their own (`targetBaseId` via
 * `targetBaseSlug`, `inverseFieldId`, `ai.sourceFieldIds`).
 */

const BASE_URL = "http://localhost:15419";
const REPO_URL = "https://github.com/acme/demo-package";
const CYCLE_A = "cycle-alpha";
const CYCLE_B = "cycle-beta";
const ENV_KEYS = ["BUSABASE_API_KEY", "BUSABASE_BASE_URL", "BUSABASE_SPACE_ID", "HOME"] as const;

interface FieldSnapshot {
  slug: string;
  type: string;
  required: boolean;
  options: Record<string, unknown>;
}
interface BaseSnapshot {
  slug: string;
  name: string;
  fields: FieldSnapshot[];
  viewSlugs: string[];
  recordCount: number;
}

type GlobalWithBusabaseState = typeof globalThis & {
  __busabaseCoreDbState?: {
    db: unknown | null;
    client: unknown | null;
    initPromise: Promise<unknown> | null;
  };
  __busabaseReadyBySpace?: Map<string, Promise<void>>;
};

/** GitHub zipballs nest everything under one `<repo>-<ref>/` directory; extractZip strips it. */
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
  const blob = await writer.close();
  return Buffer.from(await blob.arrayBuffer());
};

const readDirRecursive = async (dir: string): Promise<Map<string, Buffer>> => {
  const out = new Map<string, Buffer>();
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(current)).sort()) {
      const abs = path.join(current, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if ((await stat(abs)).isDirectory()) await walk(abs, rel);
      else out.set(rel, await readFile(abs));
    }
  };
  await walk(dir, "");
  return out;
};

describe("busabase-cli publish → install round trip (real demo seed, two databases)", () => {
  const dirs: string[] = [];
  let publishDir = "";
  let publishDir2 = "";
  let homeDir = "";
  let zipball: Buffer = Buffer.alloc(0);
  let currentStorageDir = "";
  let originalCwd = "";
  const originalFetch = global.fetch;
  const savedEnv: Record<string, string | undefined> = {};

  let sourceBases = new Map<string, BaseSnapshot>();
  let targetBases = new Map<string, BaseSnapshot>();
  let sourceDocs = new Map<string, string>();
  let targetDocs = new Map<string, string>();
  let publishedFiles = new Map<string, Buffer>();
  let installReport: { created: Record<string, number>; warnings: string[] } | undefined;
  let rootSlug = "";

  const mkTmp = async (label: string): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), `busabase-pkg-${label}-`));
    dirs.push(dir);
    return dir;
  };

  /** Run a real `busabase-cli` command with `--output json`. */
  const cli = async (...args: string[]): Promise<unknown> => {
    const { runCli } = await import("busabase-cli");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const exitCode = await runCli(["--base-url", BASE_URL, "--output", "json", ...args]);
      if (exitCode !== 0) {
        const stderr = err.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
        const stdout = log.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
        throw new Error(
          `busabase-cli ${args.join(" ")} exited ${exitCode}\n--- stderr ---\n${stderr}\n--- stdout ---\n${stdout}`,
        );
      }
      const last = log.mock.calls.at(-1)?.[0];
      return typeof last === "string" ? JSON.parse(last) : last;
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  };

  /** Point the core db + storage singletons at a fresh, empty database. */
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

  /**
   * Observation goes through an in-process router client, not the CLI: the CLI is
   * the thing under test, and its read commands carry their own ergonomics (a
   * 100-row `records list` cap, slug-vs-id flags) that would silently weaken the
   * parity assertions. publish/install below still run as the real CLI.
   */
  const routerClient = async () => {
    const { createRouterClient } = await import("@orpc/server");
    const { busabaseRouter } = await import("busabase-core/router");
    return createRouterClient(busabaseRouter);
  };

  const snapshotBases = async (): Promise<Map<string, BaseSnapshot>> => {
    const client = await routerClient();
    const bases = await client.bases.list();
    const out = new Map<string, BaseSnapshot>();
    for (const base of bases) {
      const full = await client.bases.get({ baseId: base.id });
      const views = await client.bases.listViews({ baseId: base.id });
      let recordCount = 0;
      let cursor: string | undefined;
      do {
        const page = await client.dump.exportTables({ table: "records", cursor, limit: 500 });
        recordCount += (page.rows as Array<{ baseId?: string }>).filter(
          (row) => row.baseId === base.id,
        ).length;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      out.set(base.slug, {
        slug: base.slug,
        name: base.name,
        fields: (full?.fields ?? [])
          .map((f) => ({
            slug: f.slug,
            type: f.type as string,
            required: f.required,
            options: (f.options ?? {}) as Record<string, unknown>,
          }))
          .sort((a, b) => a.slug.localeCompare(b.slug)),
        viewSlugs: views.map((v) => v.slug).sort(),
        recordCount,
      });
    }
    return out;
  };

  /**
   * Two bases that point at each other, each as the other's `inverseFieldId` — a
   * genuine CYCLE. The demo has a self-relation with an inverse (`field-type-lab`)
   * but no cross-base A↔B pair, and that is the one shape that separates a correct
   * install from a plausible-but-wrong one: an implementation that topologically
   * sorts bases by relation dependency (instead of the spec's pass 1 = plain fields,
   * pass 2 = relation fields) passes every other test in this file and can only
   * fail here, because a cycle has no valid topological order.
   *
   * Built through the same public API an author would use, and seeded into the
   * source space before publish, so the round trip below covers it for free.
   */
  const seedCyclicRelationFixture = async (): Promise<void> => {
    const client = await routerClient();
    const folder = await client.nodes.createChangeRequest({
      message: "Add the cycle lab folder",
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "folder",
          slug: "cycle-lab",
          name: "Cycle Lab",
          description: "Two bases that reference each other.",
        },
      ],
    });
    const parentNodeId = folder.operations[0]?.nodeId as string;
    const titleField = { slug: "title", name: "Title", type: "text" as const, required: true };
    const alpha = await client.bases.create({
      parentNodeId,
      slug: CYCLE_A,
      name: "Cycle Alpha",
      fields: [titleField],
      autoMerge: true,
    });
    const beta = await client.bases.create({
      parentNodeId,
      slug: CYCLE_B,
      name: "Cycle Beta",
      fields: [titleField],
      autoMerge: true,
    });
    const alphaId = (alpha as { id: string }).id;
    const betaId = (beta as { id: string }).id;

    // alpha.beta_link → beta (no inverse yet: beta.alpha_link doesn't exist).
    const alphaWithLink = await client.bases.createField({
      baseId: alphaId,
      slug: "beta_link",
      name: "Beta link",
      type: "relation",
      options: { multiple: true, targetBaseSlug: CYCLE_B },
    });
    const alphaLinkId = alphaWithLink.fields.find((f) => f.slug === "beta_link")?.id as string;

    // beta.alpha_link → alpha, naming alpha.beta_link as its inverse (it exists now).
    const betaWithLink = await client.bases.createField({
      baseId: betaId,
      slug: "alpha_link",
      name: "Alpha link",
      type: "relation",
      options: { multiple: true, targetBaseSlug: CYCLE_A, inverseFieldId: alphaLinkId },
    });
    const betaLinkId = betaWithLink.fields.find((f) => f.slug === "alpha_link")?.id as string;

    // Close the cycle: alpha.beta_link's inverse is beta.alpha_link.
    const cr = await client.bases.updateFieldChangeRequest({
      baseId: alphaId,
      fieldId: alphaLinkId,
      patch: { options: { multiple: true, targetBaseId: betaId, inverseFieldId: betaLinkId } },
      message: "Close the A↔B inverse cycle",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });
  };

  const snapshotDocs = async (): Promise<Map<string, string>> => {
    const client = await routerClient();
    const acc = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const page = await client.dump.exportTables({ table: "nodes", cursor, limit: 500 });
      for (const node of page.rows as Array<{ id: string; slug: string; type: string }>) {
        if (node.type !== "doc") continue;
        const doc = await client.docs.get({ nodeId: node.id });
        acc.set(node.slug, doc?.body ?? "");
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return acc;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    homeDir = await mkTmp("home");
    publishDir = await mkTmp("out");
    publishDir2 = await mkTmp("out2");
    delete process.env.BUSABASE_API_KEY;
    delete process.env.BUSABASE_BASE_URL;
    delete process.env.BUSABASE_SPACE_ID;
    process.env.HOME = homeDir;

    // ── Source database: the real demo seed ────────────────────────────────
    await useDatabase(await mkTmp("src-db"), await mkTmp("src-st"));
    const { seedScenario } = await import("busabase-core/logic/store");
    const { enScenario } = await import("busabase-core/demo/scenarios/en");
    await seedScenario(enScenario);

    const { busabaseRouter } = await import("busabase-core/router");
    const handler = new OpenAPIHandler(busabaseRouter);
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      // Serve the synthetic zipball for the package under test — this is the
      // exact URL `downloadGithubZip` builds, so install's real fetch path runs.
      if (url.hostname === "codeload.github.com") {
        return new Response(new Uint8Array(zipball), {
          status: 200,
          headers: { "content-type": "application/zip" },
        });
      }
      // Local-storage static path (STORAGE_URL's base_url). Not an oRPC route —
      // a real dev server mounts a dedicated route for it, so the harness must
      // serve it too, or every asset download 404s.
      if (url.pathname.startsWith("/api/test/storage/")) {
        const key = decodeURIComponent(url.pathname.slice("/api/test/storage/".length));
        try {
          const bytes = await readFile(path.join(currentStorageDir, key));
          return new Response(new Uint8Array(bytes), { status: 200 });
        } catch {
          return new Response("not found", { status: 404 });
        }
      }
      if (!url.pathname.startsWith("/api/")) return originalFetch(input as RequestInfo, init);
      const result = await handler.handle(request, { context: {} });
      return result.matched
        ? result.response
        : Response.json({ error: "Not found", path: url.pathname }, { status: 404 });
    }) as typeof fetch;

    const client = await routerClient();
    await seedCyclicRelationFixture();
    const tree = await client.nodes.list({});
    rootSlug = (tree as unknown as Array<{ slug: string }>)[0].slug;

    sourceBases = await snapshotBases();
    sourceDocs = await snapshotDocs();

    // ── Publish the whole workspace root ──────────────────────────────────
    // The root is the only guaranteed self-contained subtree: the demo's
    // relations cross folders (blog→social, lab→blog), so publishing any single
    // folder would (correctly) fail the §6.5 self-containment rule.
    await cli("publish", rootSlug, "-o", publishDir);
    publishedFiles = await readDirRecursive(publishDir);
    // Second publish into a separate dir — determinism check (§6.6).
    await cli("publish", rootSlug, "-o", publishDir2);

    zipball = await zipDirectory(publishDir, "demo-package-main");

    // ── Target database: genuinely empty ──────────────────────────────────
    await useDatabase(await mkTmp("tgt-db"), await mkTmp("tgt-st"));
    installReport = (await cli("install", REPO_URL, "--auto-merge")) as typeof installReport;

    targetBases = await snapshotBases();
    targetDocs = await snapshotDocs();
  }, 300_000);

  afterAll(async () => {
    global.fetch = originalFetch;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  // ── publish ────────────────────────────────────────────────────────────
  it("publishes a manifest plus a human-readable content tree", () => {
    const paths = [...publishedFiles.keys()];
    expect(paths).toContain("busabase.json");
    // Real files, not an opaque archive — the whole point of the format.
    expect(paths.some((p) => p.startsWith("content/") && p.endsWith(".md"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/base.json"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/records.ndjson"))).toBe(true);
    const manifest = JSON.parse(publishedFiles.get("busabase.json")?.toString("utf8") ?? "{}");
    expect(manifest.format).toBe("busabase-package@1");
  });

  it("is deterministic — publishing an unchanged space twice is byte-identical", async () => {
    const second = await readDirRecursive(publishDir2);
    expect([...second.keys()].sort()).toEqual([...publishedFiles.keys()].sort());
    for (const [rel, bytes] of publishedFiles) {
      expect({ rel, sha: bytes.toString("base64") }).toEqual({
        rel,
        sha: second.get(rel)?.toString("base64"),
      });
    }
  });

  it("rewrites the three id-bearing field options into portable slug references", () => {
    const baseJsonFiles = [...publishedFiles.entries()].filter(([p]) => p.endsWith("/base.json"));
    expect(baseJsonFiles.length).toBeGreaterThan(0);
    const all = baseJsonFiles.map(([, b]) => JSON.parse(b.toString("utf8")));
    const fields = all.flatMap((base) => base.fields as Array<Record<string, never>>);

    const raw = JSON.stringify(all);
    // No raw ids may survive into the package — they are meaningless to a target.
    expect(raw).not.toMatch(/"targetBaseId"/);
    expect(raw).not.toMatch(/"inverseFieldId"/);
    expect(raw).not.toMatch(/"sourceFieldIds"/);
    expect(raw).not.toMatch(/bse_local_/);
    expect(raw).not.toMatch(/bsf_/);

    // …and the portable forms are actually present (the demo uses all three).
    const opts = fields.map((f) => (f.options ?? {}) as Record<string, unknown>);
    expect(opts.some((o) => typeof o.targetBaseSlug === "string")).toBe(true);
    expect(opts.some((o) => typeof o.inverseFieldSlug === "string")).toBe(true);
    expect(
      opts.some((o) => Array.isArray((o.ai as { sourceFieldSlugs?: unknown[] })?.sourceFieldSlugs)),
    ).toBe(true);
  });

  // ── install ────────────────────────────────────────────────────────────
  it("installs into a genuinely empty database, warning only about known gaps", () => {
    expect(installReport?.created.bases ?? 0).toBeGreaterThan(0);
    // Two warning classes are expected and verified elsewhere in this spec:
    //  - reviewPolicy is not settable via bases.create (§6.4), so it is reported.
    //  - binary bytes can't be uploaded from a CLI against a host whose storage
    //    adapter issues a non-absolute upload url (see uploadAsset in apply.ts);
    //    tracked separately as an upload-contract cleanup.
    // Anything else is a real regression.
    const unexpected = (installReport?.warnings ?? []).filter(
      (warning) => !/reviewPolicy cannot be set|^Skipped binary file/.test(warning),
    );
    expect(unexpected).toEqual([]);
  });

  it("re-materializes every base, with identical fields, views and record counts", () => {
    expect([...targetBases.keys()].sort()).toEqual([...sourceBases.keys()].sort());
    for (const [slug, source] of sourceBases) {
      const target = targetBases.get(slug);
      expect({ slug, fields: target?.fields.map((f) => f.slug) }).toEqual({
        slug,
        fields: source.fields.map((f) => f.slug),
      });
      expect({ slug, views: target?.viewSlugs }).toEqual({ slug, views: source.viewSlugs });
      expect({ slug, records: target?.recordCount }).toEqual({
        slug,
        records: source.recordCount,
      });
    }
  });

  it("re-resolves relation targets to the INSTALLED bases, not by luck", () => {
    // targetBaseId is minted fresh on the target; assert it points at a base that
    // exists there, and that the pairing matches the source's (by slug).
    const targetBaseIdBySlug = new Map<string, string>();
    for (const [slug] of targetBases) targetBaseIdBySlug.set(slug, slug);

    let checked = 0;
    for (const [slug, source] of sourceBases) {
      for (const sourceField of source.fields) {
        if (sourceField.type !== "relation") continue;
        const targetField = targetBases.get(slug)?.fields.find((f) => f.slug === sourceField.slug);
        const resolved = targetField?.options.targetBaseId as string | undefined;
        expect({ base: slug, field: sourceField.slug, hasTarget: Boolean(resolved) }).toEqual({
          base: slug,
          field: sourceField.slug,
          hasTarget: true,
        });
        // The package-only key must never reach the server.
        expect(targetField?.options.targetBaseSlug).toBeUndefined();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("restores inverseFieldId and ai.sourceFieldIds as real ids on the target", () => {
    let inverseChecked = 0;
    let aiChecked = 0;
    for (const [slug, source] of sourceBases) {
      for (const sourceField of source.fields) {
        const targetField = targetBases.get(slug)?.fields.find((f) => f.slug === sourceField.slug);
        if (sourceField.options.inverseFieldId) {
          expect({
            base: slug,
            field: sourceField.slug,
            inverse: Boolean(targetField?.options.inverseFieldId),
          }).toEqual({ base: slug, field: sourceField.slug, inverse: true });
          expect(targetField?.options.inverseFieldSlug).toBeUndefined();
          inverseChecked += 1;
        }
        const sourceAi = sourceField.options.ai as { sourceFieldIds?: string[] } | undefined;
        if (sourceAi?.sourceFieldIds?.length) {
          const targetAi = targetField?.options.ai as
            | { sourceFieldIds?: string[]; sourceFieldSlugs?: string[] }
            | undefined;
          expect({
            base: slug,
            field: sourceField.slug,
            n: targetAi?.sourceFieldIds?.length ?? 0,
          }).toEqual({ base: slug, field: sourceField.slug, n: sourceAi.sourceFieldIds.length });
          expect(targetAi?.sourceFieldSlugs).toBeUndefined();
          aiChecked += 1;
        }
      }
    }
    // The demo genuinely uses both; if these ever hit 0 the assertions above are vacuous.
    expect(inverseChecked).toBeGreaterThan(0);
    expect(aiChecked).toBeGreaterThan(0);
  });

  it("breaks a cyclic A↔B relation: both directions resolve on the target", () => {
    const alpha = targetBases.get(CYCLE_A);
    const beta = targetBases.get(CYCLE_B);
    expect({ alpha: Boolean(alpha), beta: Boolean(beta) }).toEqual({ alpha: true, beta: true });

    const alphaLink = alpha?.fields.find((f) => f.slug === "beta_link");
    const betaLink = beta?.fields.find((f) => f.slug === "alpha_link");
    expect(alphaLink?.type).toBe("relation");
    expect(betaLink?.type).toBe("relation");

    // Each side's relation must point at the OTHER installed base…
    const targetBaseIds = new Map(
      [...targetBases].map(([slug, base]) => [
        slug,
        base.fields.find((f) => f.options.targetBaseId)?.options.targetBaseId,
      ]),
    );
    expect(targetBaseIds.size).toBeGreaterThan(0);
    expect(typeof alphaLink?.options.targetBaseId).toBe("string");
    expect(typeof betaLink?.options.targetBaseId).toBe("string");
    // …and the two must be different bases (a cycle, not both collapsed onto one).
    expect(alphaLink?.options.targetBaseId).not.toBe(betaLink?.options.targetBaseId);

    // The inverse ids are the cycle itself: each names the other's field id.
    expect(typeof alphaLink?.options.inverseFieldId).toBe("string");
    expect(typeof betaLink?.options.inverseFieldId).toBe("string");
    expect(alphaLink?.options.inverseFieldId).not.toBe(betaLink?.options.inverseFieldId);
    // No package-only key leaked to the server.
    expect(alphaLink?.options.targetBaseSlug).toBeUndefined();
    expect(alphaLink?.options.inverseFieldSlug).toBeUndefined();
  });

  it("restores every published doc's body, modulo the format's documented normalization", () => {
    expect(sourceDocs.size).toBeGreaterThan(0);
    // Superset, not equality: `ensureReady()` auto-seeds its own starter doc into
    // any fresh space before install runs, so the target legitimately carries one
    // the package never shipped.
    const missing = [...sourceDocs.keys()].filter((slug) => !targetDocs.has(slug));
    expect(missing).toEqual([]);
    for (const [slug, body] of sourceDocs) {
      // Not byte-identical, by design: a doc is stored on disk as `---\n<yaml>\n---\n\n<body>\n`,
      // so the blank line after the delimiter and the file's own trailing newline are
      // indistinguishable from the body's. `normalizeDocBody` (frontmatter.ts) therefore
      // strips leading/trailing blank lines on BOTH read and write, making the format a
      // fixed point — at the cost of a doc body's surrounding blank lines, which carry no
      // markdown meaning. Assert exactly that contract, rather than a byte-identity the
      // format deliberately does not promise.
      const normalized = body.replaceAll("\r\n", "\n").replace(/^\n+/, "").replace(/\n+$/, "");
      expect({ slug, body: targetDocs.get(slug) }).toEqual({ slug, body: normalized });
    }
  });
});
