import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `busabase-cli export` → `busabase-cli install` round trip, driven through the
 * REAL CLI against a REAL router (CLI → busabase-sdk → oRPC → busabase-core →
 * PGlite), with `fetch` redirected in-process — the same harness convention as
 * `cli-golden-path.test.ts`, extended to also serve a synthetic GitHub zipball
 * so `install` exercises its true code path (codeload URL → zip → extract →
 * read → plan → five-pass apply), not a test-only shortcut.
 *
 * The round trip crosses two DATABASES, not two spaces: OSS busabase is
 * single-space (the `/api/v1` route runs `runWithBusabaseContext` with no
 * spaceId, so `getContextSpaceId()` is always `LOCAL_SPACE_ID`), and base slugs
 * are unique per space — so exporting and re-installing into the same database
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
const IMAGE_DOC_SLUG = "illustrated";
const DOC_IMAGE_FILENAME = "round-trip-diagram.png";
/** A real 1×1 PNG — small, but genuine bytes, so "byte-identical" means something. */
const DOC_IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
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

describe("busabase-cli export → install round trip (real demo seed, two databases)", () => {
  const dirs: string[] = [];
  let exportDir = "";
  let exportDir2 = "";
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
  let exportedFiles = new Map<string, Buffer>();
  let exportReport: { exported: boolean; files: string[] } | undefined;
  let installReport: { created: Record<string, number>; warnings: string[] } | undefined;
  let rootSlug = "";
  let sourceImageAssetId = "";

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
    // `upload_url` is ABSOLUTE on purpose. A client (the CLI here) will only
    // follow an upload url it can actually address — the local adapter's default
    // is root-relative, which an out-of-process client cannot resolve, and
    // `uploadAsset` refuses it rather than guessing (see apply.ts). Pointing it
    // at the harness's own origin is the same thing a real self-hosted deployment
    // does with `upload_url=https://host/api/storage/upload`, and it is what lets
    // this test cover binary bytes at all: a Doc's inline images, and file nodes.
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage&upload_url=${BASE_URL}/api/test/storage-upload`;
    const { resetStorage } = await import("openlib/storage");
    resetStorage();
  };

  /**
   * Observation goes through an in-process router client, not the CLI: the CLI is
   * the thing under test, and its read commands carry their own ergonomics (a
   * 100-row `records list` cap, slug-vs-id flags) that would silently weaken the
   * parity assertions. export/install below still run as the real CLI.
   */
  const routerClient = async () => {
    const { createRouterClient } = await import("@orpc/server");
    const { busabaseRouter } = await import("busabase-core/router");
    return createRouterClient(busabaseRouter);
  };

  const snapshotBases = async (): Promise<Map<string, BaseSnapshot>> => {
    const client = await routerClient();
    const bases = await client.bases.list({});
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
   * source space before export, so the round trip below covers it for free.
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
    const cr = await client.bases.fieldChangeRequest({
      operation: "update",
      baseId: alphaId,
      fieldId: alphaLinkId,
      patch: { options: { multiple: true, targetBaseId: betaId, inverseFieldId: betaLinkId } },
      message: "Close the A↔B inverse cycle",
    });
    await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [cr.id] });
  };

  /**
   * A Doc with an inline image, seeded exactly the way the Doc editor produces
   * one: the bytes go into the Asset library, and the body references the ASSET
   * (`/api/assets/{id}/raw`), never the storage location.
   *
   * The demo seed has no such doc, and it is the only shape that distinguishes a
   * package that carries a Doc's images from one that carries only its markdown.
   * Without it the round trip below is green on a package whose every doc image
   * installs dead.
   */
  const seedDocWithImageFixture = async (): Promise<void> => {
    const client = await routerClient();
    const contentHash = `sha256:${createHash("sha256").update(DOC_IMAGE_BYTES).digest("hex")}`;
    const requested = await client.assets.createUploadUrl({
      fileName: DOC_IMAGE_FILENAME,
      mimeType: "image/png",
      sizeBytes: DOC_IMAGE_BYTES.byteLength,
      context: "doc",
      contentHash,
    });
    const put = await fetch(requested.uploadUrl, {
      method: "PUT",
      body: new Uint8Array(DOC_IMAGE_BYTES),
      headers: { "content-type": "image/png" },
    });
    if (!put.ok) throw new Error(`fixture image upload failed (${put.status})`);
    const confirmed = await client.assets.confirm({
      storageKey: requested.storageKey,
      fileName: DOC_IMAGE_FILENAME,
      mimeType: "image/png",
      sizeBytes: DOC_IMAGE_BYTES.byteLength,
      context: "doc",
      contentHash,
    });
    sourceImageAssetId = confirmed.assetId ?? confirmed.attachmentId;

    const folder = await client.nodes.createChangeRequest({
      message: "Add the illustrated doc folder",
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "folder",
          slug: "image-lab",
          name: "Image Lab",
          description: "A doc that shows an uploaded image.",
        },
      ],
    });
    await client.docs.create({
      parentNodeId: folder.operations[0]?.nodeId as string,
      slug: IMAGE_DOC_SLUG,
      name: "Illustrated",
      description: "",
      body: `# Illustrated\n\n![Diagram](/api/assets/${sourceImageAssetId}/raw)\n`,
      autoMerge: true,
    });
  };

  const snapshotDocs = async (): Promise<Map<string, string>> => {
    const client = await routerClient();
    const acc = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const page = await client.dump.exportTables({ table: "nodes", cursor, limit: 500 });
      for (const node of page.rows as Array<{ id: string; slug: string; type: string }>) {
        if (node.type !== "doc") continue;
        // `docs.get` was retired by the unified Node surface; `nodes.get`
        // returns the same Doc payload under the `type: "doc"` variant.
        const doc = await client.nodes.get({ nodeId: node.id, type: "doc" });
        acc.set(node.slug, doc.type === "doc" ? doc.body : "");
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return acc;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    homeDir = await mkTmp("home");
    exportDir = await mkTmp("out");
    exportDir2 = await mkTmp("out2");
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
      // Write counterpart of the static path below (STORAGE_URL's `upload_url`).
      // A real host mounts `/api/storage/upload` for exactly this: raw bytes in
      // the body, `?key=` in the query — the shape of an S3 presigned PUT, so
      // the client never learns whether it is talking to S3 or local disk.
      if (url.pathname === "/api/test/storage-upload") {
        const key = decodeURIComponent(url.searchParams.get("key") ?? "");
        if (!key) return new Response("Missing key", { status: 400 });
        const target = path.join(currentStorageDir, key);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(await request.arrayBuffer()));
        return new Response(null, { status: 200 });
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
    await seedDocWithImageFixture();
    const tree = await client.nodes.list({});
    rootSlug = (tree as unknown as Array<{ slug: string }>)[0].slug;

    sourceBases = await snapshotBases();
    sourceDocs = await snapshotDocs();

    // ── Export the whole workspace root ───────────────────────────────────
    // The root is the only guaranteed self-contained subtree: the demo's
    // relations cross folders (blog→social, lab→blog), so exporting any single
    // folder would (correctly) fail the §6.5 self-containment rule.
    exportReport = (await cli("export", rootSlug, "-o", exportDir)) as typeof exportReport;
    exportedFiles = await readDirRecursive(exportDir);
    // Second export into a separate dir — determinism check (§6.6).
    await cli("export", rootSlug, "-o", exportDir2);

    zipball = await zipDirectory(exportDir, "demo-package-main");

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

  // ── export ─────────────────────────────────────────────────────────────
  it("exports a manifest plus a human-readable content tree", () => {
    expect(exportReport?.exported).toBe(true);
    expect(exportReport?.files).toContain("busabase.json");
    const paths = [...exportedFiles.keys()];
    expect(paths).toContain("busabase.json");
    // Real files, not an opaque archive — the whole point of the format.
    expect(paths.some((p) => p.startsWith("content/") && p.endsWith(".md"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/base.json"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/records.ndjson"))).toBe(true);
    const manifest = JSON.parse(exportedFiles.get("busabase.json")?.toString("utf8") ?? "{}");
    expect(manifest.format).toBe("busabase-package@1");
  });

  it("is deterministic — exporting an unchanged space twice is byte-identical", async () => {
    const second = await readDirRecursive(exportDir2);
    expect([...second.keys()].sort()).toEqual([...exportedFiles.keys()].sort());
    for (const [rel, bytes] of exportedFiles) {
      expect({ rel, sha: bytes.toString("base64") }).toEqual({
        rel,
        sha: second.get(rel)?.toString("base64"),
      });
    }
  });

  it("rewrites the three id-bearing field options into portable slug references", () => {
    const baseJsonFiles = [...exportedFiles.entries()].filter(([p]) => p.endsWith("/base.json"));
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

  it("re-installing the same package into a second folder of an already-populated target creates genuinely new nodes, not silent no-ops", async () => {
    // Regression for a real bug: `createFileTreeNode`'s idempotency check used
    // to match an "already exists?" node by (spaceId, type, slug) alone, ignoring
    // the parent folder — plan.ts's own docstring above documents node slugs as
    // unique per PARENT, not per space, and its collision detector is scoped to
    // the target folder accordingly. So installing this same package again under
    // a DIFFERENT --into-folder in the SAME (now populated) target database is a
    // legitimate, collision-free install by that rule — but before the fix, any
    // node whose slug already existed under the first install's folder (e.g. the
    // "ai-research-editor" skill) silently resolved to that unrelated existing
    // node instead of being created under the new folder, while still reporting
    // success. Caught by exporting to a real GitHub repo and installing twice by
    // hand; this pins it down as an automated test.
    const client = await routerClient();
    const before = await client.nodes.list({});

    // --rename is needed because base slugs collide SPACE-WIDE by design (see
    // plan.ts's docstring) — every base in this package already exists from the
    // first install. That is unrelated to the bug under test: node types like
    // `skill` collide only per-PARENT, and "second-copy" is a different parent
    // from the first install's folder, so they were never a real collision —
    // `--rename` only touches the (expected, by-design) base collisions.
    const secondReport = (await cli(
      "install",
      REPO_URL,
      "--into-folder",
      "second-copy",
      "--auto-merge",
      "--rename",
    )) as { created: Record<string, number>; warnings: string[] };

    // Real materialization happened — not a silent zero-op. `fileTreeNodes`
    // covers skills/drives/airapps alike (see apply.ts's `applyFileTreeCreate`).
    expect(secondReport.created.bases ?? 0).toBeGreaterThan(0);
    expect(secondReport.created.fileTreeNodes ?? 0).toBeGreaterThan(0);

    const after = await client.nodes.list({});
    type TreeNode = { id: string; slug: string; type: string; children?: TreeNode[] };
    const roots = (tree: unknown): TreeNode[] => {
      const arr = tree as TreeNode[];
      return arr.length === 1 && arr[0].children ? (arr[0].children ?? []) : arr;
    };
    /** First node anywhere in the tree matching (slug, type), depth-first. */
    const findAnywhere = (nodes: TreeNode[], slug: string, type: string): TreeNode | undefined => {
      for (const n of nodes) {
        if (n.slug === slug && n.type === type) return n;
        const found = findAnywhere(n.children ?? [], slug, type);
        if (found) return found;
      }
      return undefined;
    };
    /** Same, but restricted to the subtree under a top-level folder slug. */
    const findUnderFolder = (
      tree: unknown,
      folderSlug: string,
      slug: string,
      type: string,
    ): TreeNode | undefined => {
      const folder = findAnywhere(roots(tree), folderSlug, "folder");
      return folder ? findAnywhere(folder.children ?? [], slug, type) : undefined;
    };

    const firstCopySkill = findUnderFolder(before, "skills", "ai-research-editor", "skill");
    const secondCopySkill = findUnderFolder(after, "second-copy", "ai-research-editor", "skill");
    expect(firstCopySkill?.id).toBeTruthy();
    expect(secondCopySkill?.id).toBeTruthy();
    // The whole point: a genuinely new node, not the first install's node reused.
    expect(secondCopySkill?.id).not.toBe(firstCopySkill?.id);
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

  it("restores every exported doc's body, modulo the format's documented normalization", () => {
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
      // Asset ids are host-local: install re-uploads the carried images and the
      // body is re-pointed at the NEW ids (asserted for real just below). So the
      // body-restoration contract is "identical modulo asset ids", not literal
      // equality — an id that did NOT change would mean the rewrite never ran.
      const maskIds = (value: string) =>
        value.replace(/\/api\/assets\/[^/]+\/raw/g, "/api/assets/*/raw");
      expect({ slug, body: maskIds(targetDocs.get(slug) ?? "") }).toEqual({
        slug,
        body: maskIds(normalized),
      });
    }
  });

  // ── a doc's inline images ──────────────────────────────────────────────
  it("carries the bytes behind a doc's inline image, not just its markdown", () => {
    const bytesPath = `assets/${sourceImageAssetId}.png`;
    // The exported markdown still names the SOURCE asset id — that is the whole
    // point of the sidecar: it is what install maps from.
    const docBody = exportedFiles.get(`content/image-lab/${IMAGE_DOC_SLUG}.md`)?.toString("utf8");
    expect(docBody).toContain(`/api/assets/${sourceImageAssetId}/raw`);

    expect([...exportedFiles.keys()]).toContain(bytesPath);
    expect(exportedFiles.get(bytesPath)?.equals(DOC_IMAGE_BYTES)).toBe(true);

    const sidecar = JSON.parse(
      exportedFiles.get(`${bytesPath}.asset.json`)?.toString("utf8") ?? "{}",
    );
    expect(sidecar).toMatchObject({
      assetId: sourceImageAssetId,
      fileName: DOC_IMAGE_FILENAME,
      mimeType: "image/png",
    });
    expect(sidecar.contentHash).toMatch(/^sha256:/);
  });

  it("re-creates the image on the target and re-points the doc at the NEW asset id", async () => {
    const client = await routerClient();
    const body = targetDocs.get(IMAGE_DOC_SLUG) ?? "";
    const targetAssetId = body.match(/\/api\/assets\/([^/]+)\/raw/)?.[1];
    expect(targetAssetId).toBeTruthy();
    // A brand-new host-local id, not the source's — and not a dead reference.
    expect(targetAssetId).not.toBe(sourceImageAssetId);

    const detail = await client.assets.get({ assetId: targetAssetId as string });
    expect(detail.asset.fileName).toBe(DOC_IMAGE_FILENAME);
    expect(detail.asset.mimeType).toBe("image/png");

    // The bytes really are there, and really are the same bytes.
    const download = await client.assets.download({ assetId: targetAssetId as string });
    const fetched = await fetch(new URL(download.downloadUrl, BASE_URL));
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(DOC_IMAGE_BYTES)).toBe(true);

    // …and the where-used index knows the doc shows it, which is also what the
    // asset ACL uses to decide the image is readable at all.
    const docUsage = detail.usages.find((usage) => usage.ownerType === "doc");
    expect(docUsage?.nodeSlug).toBe(IMAGE_DOC_SLUG);
  });

  it("does not warn about doc images any more — the package now carries them", () => {
    const carried = (installReport?.warnings ?? []).filter((warning) =>
      /does not carry/.test(warning),
    );
    expect(carried).toEqual([]);
  });
});
