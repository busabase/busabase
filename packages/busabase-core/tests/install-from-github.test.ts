import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { PACKAGE_FORMAT } from "busabase-contract/domains/package/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * Server-side "Install from GitHub" (spec §15), end to end: a synthetic
 * GitHub-shaped zipball served by an intercepted `global.fetch`, a real PGLite DB
 * and local object storage, and the real `install.*` procedures called through an
 * oRPC router client.
 *
 * The zipball interception is the same pattern `apps/busabase/tests/package-roundtrip.test.ts`
 * proved: serving the exact URL `downloadGithubZip` builds means install runs its
 * TRUE code path (codeload URL → SSRF guard → zip → extract → read → plan →
 * five-pass apply), not a mock of it.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

/** GitHub zipballs nest everything under one `<repo>-<ref>/` directory; extractZip strips it. */
const zipFiles = async (files: Map<string, string>, archiveRoot: string): Promise<Buffer> => {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [relativePath, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    await writer.add(
      `${archiveRoot}/${relativePath}`,
      new BlobReader(new Blob([new TextEncoder().encode(content)])),
    );
  }
  const blob = await writer.close();
  return Buffer.from(await blob.arrayBuffer());
};

/** A small but structurally complete package: manifest + folder + doc + base + records. */
const buildPackageFiles = (packageName: string): Map<string, string> =>
  new Map<string, string>([
    [
      "busabase.json",
      JSON.stringify({
        format: PACKAGE_FORMAT,
        name: packageName,
        description: "A test package",
        version: "1.0.0",
        tags: ["test"],
      }),
    ],
    ["content/getting-started.md", "---\nname: Getting Started\n---\n\nRead me first.\n"],
    ["content/guides/_folder.json", JSON.stringify({ name: "Guides", position: 1 })],
    ["content/guides/faq.md", "---\nname: FAQ\n---\n\nFrequently asked questions.\n"],
    [
      "content/articles/base.json",
      JSON.stringify({
        name: "Articles",
        description: "Editorial pipeline",
        position: 2,
        fields: [
          { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
          {
            slug: "status",
            name: "Status",
            type: "select",
            required: false,
            position: 1,
            options: {
              choices: [
                { id: "choice_draft", name: "Draft", color: "gray" },
                { id: "choice_live", name: "Live", color: "green" },
              ],
            },
          },
        ],
        views: [],
      }),
    ],
    [
      "content/articles/records.ndjson",
      [
        JSON.stringify({ key: "rec_a", fields: { title: "First post", status: "Draft" } }),
        JSON.stringify({ key: "rec_b", fields: { title: "Second post", status: "Live" } }),
      ].join("\n"),
    ],
  ]);

/**
 * A package whose records carry a relation VALUE — the one shape that genuinely
 * cannot be installed review-first (a relation stores the ids of records that
 * only exist once they are merged). Used to pin `applicable`'s meaning below.
 */
const buildRelationPackageFiles = (packageName: string): Map<string, string> =>
  new Map<string, string>([
    [
      "busabase.json",
      JSON.stringify({ format: PACKAGE_FORMAT, name: packageName, description: "Relations" }),
    ],
    [
      "content/authors/base.json",
      JSON.stringify({
        name: "Authors",
        description: "",
        position: 0,
        fields: [
          { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
        ],
        views: [],
      }),
    ],
    [
      "content/authors/records.ndjson",
      JSON.stringify({ key: "rec_author", fields: { title: "Ada" } }),
    ],
    [
      "content/posts/base.json",
      JSON.stringify({
        name: "Posts",
        description: "",
        position: 1,
        fields: [
          { slug: "title", name: "Title", type: "text", required: true, position: 0, options: {} },
          {
            slug: "author",
            name: "Author",
            type: "relation",
            required: false,
            position: 1,
            options: { targetBaseSlug: "authors" },
          },
        ],
        views: [],
      }),
    ],
    [
      "content/posts/records.ndjson",
      JSON.stringify({ key: "rec_post", fields: { title: "Hello", author: ["rec_author"] } }),
    ],
  ]);

describe("install.fromGithub — server-side install (real PGLite + synthetic zipball)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let zipball: Buffer = Buffer.alloc(0);
  let codeloadRequests = 0;
  const originalFetch = global.fetch;

  const inSpace = <T>(spaceId: string, fn: () => Promise<T>): Promise<T> =>
    runWithBusabaseContext({ spaceId }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-install-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-install-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    // Boot PGLite (and run migrations) BEFORE swapping `global.fetch`. PGLite
    // loads its wasm/data through fetch, so a test-owned fetch installed first
    // would sit in the middle of database startup.
    await runWithBusabaseContext({ spaceId: "space_install_warmup" }, () => client.nodes.list());

    zipball = await zipFiles(buildPackageFiles("test-kb"), "acme-test-kb-main");
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      // Read the URL as a string and delegate untouched otherwise: constructing a
      // `Request` here would throw on the non-http URLs other machinery may fetch.
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (rawUrl.startsWith("https://codeload.github.com/")) {
        codeloadRequests++;
        return new Response(new Uint8Array(zipball), {
          status: 200,
          headers: { "content-type": "application/zip" },
        });
      }
      return originalFetch(input as RequestInfo, init);
    }) as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  // ── planFromGithub: a dry run that creates nothing ──────────────────────────
  it("planFromGithub reports the tree, per-base record counts, and creates nothing", async () => {
    const spaceId = "space_install_plan";
    const plan = await inSpace(spaceId, () =>
      client.install.planFromGithub({ repoUrl: "https://github.com/acme/test-kb" }),
    );

    expect(plan.package.name).toBe("test-kb");
    expect(plan.package.version).toBe("1.0.0");
    expect(plan.source).toMatchObject({ owner: "acme", repo: "test-kb" });
    expect(plan.targetFolderSlug).toBe("test-kb");
    expect(plan.counts).toMatchObject({ folders: 1, docs: 2, bases: 1, records: 2 });
    expect(plan.collisions).toEqual([]);
    expect(plan.applicable).toBe(true);
    // No relation VALUES, so a review-first install is fine.
    expect(plan.requiresAutoMerge).toBe(false);

    const articles = plan.nodes.find((node) => node.slug === "articles");
    expect(articles).toMatchObject({ type: "base", fieldCount: 2, recordCount: 2 });
    // `faq` is nested under `guides`, so the outline must carry the nesting.
    expect(plan.nodes.find((node) => node.slug === "faq")).toMatchObject({
      depth: 1,
      path: "guides/faq",
    });

    // Nothing was created.
    const nodes = await inSpace(spaceId, () => client.nodes.list());
    const roots = nodes.length === 1 && nodes[0].children ? nodes[0].children : nodes;
    expect(roots.map((node) => node.slug)).not.toContain("test-kb");
  });

  // ── fromGithub: the content really materializes ─────────────────────────────
  it("fromGithub materializes the folder, docs, base and records in the DB", async () => {
    const spaceId = "space_install_apply";
    const result = await inSpace(spaceId, () =>
      client.install.fromGithub({
        repoUrl: "https://github.com/acme/test-kb",
        autoMerge: true,
      }),
    );

    expect(result.targetFolderSlug).toBe("test-kb");
    expect(result.targetFolderNodeId).toBeTruthy();
    expect(result.created.folders).toBe(2); // the target folder + `guides`
    expect(result.created.docs).toBe(2);
    expect(result.created.bases).toBe(1);
    expect(result.created.records).toBe(2);
    expect(result.pendingChangeRequests).toBe(0);

    // Node tree.
    const nodes = await inSpace(spaceId, () => client.nodes.list());
    const roots = nodes.length === 1 && nodes[0].children ? nodes[0].children : nodes;
    const installed = roots.find((node) => node.slug === "test-kb");
    expect(installed?.type).toBe("folder");
    expect(installed?.children?.map((node) => node.slug).sort()).toEqual([
      "articles",
      "getting-started",
      "guides",
    ]);

    // Doc bodies.
    const gettingStarted = installed?.children?.find((node) => node.slug === "getting-started");
    const doc = await inSpace(spaceId, () => client.docs.get({ nodeId: gettingStarted?.id ?? "" }));
    expect(doc.body).toContain("Read me first.");

    // Base schema + records.
    const bases = await inSpace(spaceId, () => client.bases.list());
    const articles = bases.find((base) => base.slug === "articles");
    expect(articles).toBeTruthy();
    expect(articles?.fields.map((field) => field.slug).sort()).toEqual(["status", "title"]);

    const { records } = await inSpace(spaceId, () =>
      client.records.listPaged({ baseId: articles?.id ?? "" }),
    );
    const titles = records
      .map((record) => record.headCommit?.fields?.title)
      .filter(Boolean)
      .sort();
    expect(titles).toEqual(["First post", "Second post"]);
    // Select values survive the round trip through the package format.
    expect(records.map((record) => record.headCommit?.fields?.status).sort()).toEqual([
      "Draft",
      "Live",
    ]);
  });

  // ── review-first: content lands as change requests ──────────────────────────
  it("without autoMerge, records land as change requests instead of live rows", async () => {
    const spaceId = "space_install_review";
    const result = await inSpace(spaceId, () =>
      client.install.fromGithub({ repoUrl: "https://github.com/acme/test-kb" }),
    );

    // Structure is always materialized (a pending Base has no id to attach a
    // record to); content is proposed.
    expect(result.created.bases).toBe(1);
    expect(result.created.records).toBe(0);
    expect(result.pendingChangeRequests).toBeGreaterThan(0);

    const bases = await inSpace(spaceId, () => client.bases.list());
    const articles = bases.find((base) => base.slug === "articles");
    const { records } = await inSpace(spaceId, () =>
      client.records.listPaged({ baseId: articles?.id ?? "" }),
    );
    expect(records).toHaveLength(0);
  });

  // ── collisions ──────────────────────────────────────────────────────────────
  it("refuses a second install into the same space, and reports the colliding slugs", async () => {
    const spaceId = "space_install_collision";
    await inSpace(spaceId, () =>
      client.install.fromGithub({
        repoUrl: "https://github.com/acme/test-kb",
        autoMerge: true,
      }),
    );

    const plan = await inSpace(spaceId, () =>
      client.install.planFromGithub({ repoUrl: "https://github.com/acme/test-kb" }),
    );
    expect(plan.applicable).toBe(false);
    // Base slugs are unique per SPACE, so `articles` collides regardless of folder.
    // The reason travels structurally (no CLI-worded `blockedReason` in the VO —
    // a dialog with checkboxes can't render "re-run with --rename").
    expect(plan.collisions.map((collision) => collision.slug)).toContain("articles");
    expect(plan.collisions.every((collision) => collision.renamedTo === undefined)).toBe(true);

    await expect(
      inSpace(spaceId, () =>
        client.install.fromGithub({
          repoUrl: "https://github.com/acme/test-kb",
          autoMerge: true,
        }),
      ),
    ).rejects.toThrow(/collide/i);
  });

  // ── security: the admin gate ────────────────────────────────────────────────
  //
  // These fail if `requireSpaceManagerForInstall()` is removed from either
  // procedure — a package can carry skills and AirApps, i.e. code the space's
  // agents will execute, so installing one is an admin act.
  it("FORBIDS a non-manager from installing", async () => {
    await expect(
      runWithBusabaseContext({ spaceId: "space_install_rbac", isSpaceManager: false }, () =>
        client.install.fromGithub({
          repoUrl: "https://github.com/acme/test-kb",
          autoMerge: true,
        }),
      ),
    ).rejects.toThrow(/owner\/admin|does not have access/i);
  });

  it("FORBIDS a non-manager from even dry-running an install", async () => {
    // The dry run is gated too: it makes the server fetch a caller-named repo and
    // reports back every colliding slug already in the space.
    await expect(
      runWithBusabaseContext({ spaceId: "space_install_rbac", isSpaceManager: false }, () =>
        client.install.planFromGithub({ repoUrl: "https://github.com/acme/test-kb" }),
      ),
    ).rejects.toThrow(/owner\/admin|does not have access/i);
  });

  it("does not fetch anything when the caller is not a manager", async () => {
    const before = codeloadRequests;
    await expect(
      runWithBusabaseContext({ spaceId: "space_install_rbac", isSpaceManager: false }, () =>
        client.install.planFromGithub({ repoUrl: "https://github.com/acme/test-kb" }),
      ),
    ).rejects.toThrow();
    expect(codeloadRequests).toBe(before);
  });

  // ── `applicable` answers "with THESE options", not "is this package ok" ─────
  //
  // Regression: the plan used to hardcode `autoMerge: false`, so a package whose
  // records carry relation values always came back `applicable: false` — the
  // exact packages auto-merge exists to install. A client gating its submit
  // button on that flag would have made them permanently uninstallable.
  it("reports a relation-values package as applicable only when planned WITH autoMerge", async () => {
    const previous = zipball;
    zipball = await zipFiles(buildRelationPackageFiles("rel-kb"), "acme-rel-kb-main");
    try {
      const spaceId = "space_install_applicable";
      const withoutAutoMerge = await inSpace(spaceId, () =>
        client.install.planFromGithub({ repoUrl: "https://github.com/acme/rel-kb" }),
      );
      const withAutoMerge = await inSpace(spaceId, () =>
        client.install.planFromGithub({
          repoUrl: "https://github.com/acme/rel-kb",
          autoMerge: true,
        }),
      );

      // Same package, same collisions (none) — only the asked-for options differ.
      expect(withoutAutoMerge.requiresAutoMerge).toBe(true);
      expect(withAutoMerge.requiresAutoMerge).toBe(true);
      expect(withoutAutoMerge.applicable).toBe(false);
      expect(withAutoMerge.applicable).toBe(true);
    } finally {
      zipball = previous;
    }
  });

  // ── security: SSRF / host allowlist ─────────────────────────────────────────
  //
  // These fail if the allowlist or `checkUrlIsSafeToFetch` is removed. Each
  // asserts the refusal happens BEFORE any network I/O, which is the whole point
  // of a guard: a check that runs after the request has already left is not one.
  it.each([
    ["a non-GitHub host", "https://evil.example.com/acme/test-kb"],
    ["a host that merely contains github.com", "https://evil.example/github.com/acme/test-kb"],
    ["an internal address", "http://169.254.169.254/latest/meta-data"],
    ["localhost", "http://localhost:8080/acme/test-kb"],
    ["a non-http scheme", "file:///etc/passwd"],
  ])("refuses %s before any fetch", async (_label, repoUrl) => {
    const before = codeloadRequests;
    await expect(
      inSpace("space_install_ssrf", () => client.install.planFromGithub({ repoUrl })),
    ).rejects.toThrow();
    expect(codeloadRequests).toBe(before);
  });

  it("refuses a non-GitHub host on the write path too", async () => {
    const before = codeloadRequests;
    await expect(
      inSpace("space_install_ssrf", () =>
        client.install.fromGithub({
          repoUrl: "https://evil.example.com/acme/test-kb",
          autoMerge: true,
        }),
      ),
    ).rejects.toThrow();
    expect(codeloadRequests).toBe(before);
  });
});
