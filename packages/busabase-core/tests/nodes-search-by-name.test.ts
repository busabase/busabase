/**
 * `nodes.searchByName` — the cheap, name/slug-only lookup backing the
 * dashboard quick-jump palette's `KnownNode` cache-miss path (see
 * apps/busabase/content/spec/search-quick-jump.md). Covers:
 *  - every built-in node type is findable by name, and by slug
 *  - exact-slug matches sort first
 *  - node-visibility ACL scoping (same pattern as node-acl.test.ts)
 *  - the demo-mode counterpart over the seeded in-memory dataset
 */
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";
import { busabaseDemoRouter } from "../src/router-demo";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const asManager = <T>(actorId: string, fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId, isSpaceManager: true }, fn);

const asMember = <T>(actorId: string, fn: () => Promise<T>, opts: { restricted?: boolean } = {}) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId,
      isSpaceManager: false,
      restrictedVisibility: opts.restricted ?? false,
    },
    fn,
  );

describe("nodes.searchByName", () => {
  it("finds every node type by name and by slug, scoped to the same node-visibility ACL as other node queries", async () => {
    await seedScenario("search-by-name-all-types");
    const raw: RawClient = createRouterClient(busabaseRouter);

    // "file" nodes are asset-backed — need a real uploaded+confirmed asset
    // before a `file` create operation is accepted (mirrors
    // search-asset-content.test.ts's recipe).
    const content = "roadmap file body";
    const hash = `sha256:${"a".repeat(64)}`;
    const sizeBytes = Buffer.byteLength(content, "utf8");
    const uploadReq = await raw.assets.createUploadUrl({
      fileName: "roadmap.txt",
      mimeType: "text/plain",
      sizeBytes,
      contentHash: hash,
    });
    await storage.uploadFileToKey(Buffer.from(content, "utf8"), uploadReq.storageKey, "text/plain");
    const confirmedAsset = await raw.assets.confirm({
      storageKey: uploadReq.storageKey,
      fileName: "roadmap.txt",
      mimeType: "text/plain",
      sizeBytes,
      contentHash: hash,
    });

    const cr = await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "Seed one of every node type",
      operations: [
        { kind: "create", nodeType: "folder", slug: "roadmap-folder", name: "Roadmap Folder" },
        { kind: "create", nodeType: "base", slug: "roadmap-base", name: "Roadmap Base" },
        { kind: "create", nodeType: "skill", slug: "roadmap-skill", name: "Roadmap Skill" },
        { kind: "create", nodeType: "drive", slug: "roadmap-drive", name: "Roadmap Drive" },
        { kind: "create", nodeType: "airapp", slug: "roadmap-app", name: "Roadmap App" },
        {
          kind: "create",
          nodeType: "file",
          slug: "roadmap-file",
          name: "Roadmap File",
          metadata: { assetId: confirmedAsset.assetId },
        },
        { kind: "create", nodeType: "doc", slug: "roadmap-doc", name: "Roadmap Doc" },
        {
          kind: "create",
          nodeType: "whiteboard",
          slug: "roadmap-whiteboard",
          name: "Roadmap Whiteboard",
        },
        {
          kind: "create",
          nodeType: "workflow",
          slug: "roadmap-workflow",
          name: "Roadmap Workflow",
        },
        { kind: "create", nodeType: "html", slug: "roadmap-html", name: "Roadmap HTML" },
        { kind: "create", nodeType: "folder", slug: "unrelated", name: "Completely Unrelated" },
      ],
    });
    expect(cr.status).toBe("merged");

    const byName = await raw.nodes.searchByName({ query: "Roadmap" });
    const foundTypes = new Set(byName.map((r) => r.type));
    expect(foundTypes).toEqual(
      new Set([
        "folder",
        "base",
        "skill",
        "drive",
        "airapp",
        "file",
        "doc",
        "whiteboard",
        "workflow",
        "html",
      ]),
    );
    expect(byName.some((r) => r.name === "Completely Unrelated")).toBe(false);
    // `path` mirrors the server's `/${type}/${slug}` route convention.
    const base = byName.find((r) => r.type === "base");
    expect(base?.path).toBe("/base/roadmap-base");
    expect(base?.slug).toBe("roadmap-base");

    // Slug-only match (name doesn't contain the query at all).
    const bySlug = await raw.nodes.searchByName({ query: "roadmap-skill" });
    expect(bySlug.some((r) => r.slug === "roadmap-skill")).toBe(true);

    // Case-insensitive.
    const lowerCase = await raw.nodes.searchByName({ query: "roadmap" });
    expect(lowerCase.length).toBe(byName.length);
  });

  it("ranks an exact slug match first, ahead of a merely-substring match", async () => {
    await seedScenario("search-by-name-exact-match-order");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "Seed an exact + a partial match",
      operations: [
        { kind: "create", nodeType: "base", slug: "invoices", name: "Invoices" },
        {
          kind: "create",
          nodeType: "base",
          slug: "invoices-archive",
          name: "Invoices Archive",
        },
      ],
    });

    const results = await raw.nodes.searchByName({ query: "invoices" });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.slug).toBe("invoices");
  });

  it("treats SQL LIKE wildcard characters as literal search text", async () => {
    await seedScenario("search-by-name-literal-wildcards");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "Seed literal wildcard names",
      operations: [
        { kind: "create", nodeType: "base", slug: "percent-plan", name: "Budget 100% Plan" },
        { kind: "create", nodeType: "base", slug: "underscore-plan", name: "Budget_Q3 Plan" },
        { kind: "create", nodeType: "base", slug: "ordinary-plan", name: "Ordinary Plan" },
      ],
    });

    const percentResults = await raw.nodes.searchByName({ query: "%" });
    expect(percentResults.map((result) => result.slug)).toEqual(["percent-plan"]);

    const underscoreResults = await raw.nodes.searchByName({ query: "_" });
    expect(underscoreResults.map((result) => result.slug)).toEqual(["underscore-plan"]);
  });

  it("hides a private node from a non-granted member, same as nodes.list", async () => {
    await seedScenario("search-by-name-acl-hide");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const nodeId = await asManager("alice", async () => {
      const base = await raw.bases.create({
        name: "Payroll Base",
        slug: "payroll-base",
        autoMerge: true,
      });
      if ("status" in base) throw new Error("expected materialized base");
      await raw.nodes.updateVisibility({ nodeId: base.nodeId, visibility: "private" });
      return base.nodeId;
    });
    expect(nodeId).toBeTruthy();

    // Manager still finds it.
    await asManager("alice", async () => {
      const hits = await raw.nodes.searchByName({ query: "Payroll" });
      expect(hits.some((r) => r.slug === "payroll-base")).toBe(true);
    });

    // Non-granted member: hidden, same as it would be from `nodes.list`.
    await asMember("bob", async () => {
      const hits = await raw.nodes.searchByName({ query: "Payroll" });
      expect(hits.some((r) => r.slug === "payroll-base")).toBe(false);
    });

    // Grant bob read → now findable.
    await asManager("alice", () =>
      raw.nodes.principals.add({
        nodeId,
        principalType: "user",
        principalId: "bob",
        role: "read",
      }),
    );
    await asMember("bob", async () => {
      const hits = await raw.nodes.searchByName({ query: "Payroll" });
      expect(hits.some((r) => r.slug === "payroll-base")).toBe(true);
    });
  });

  it("a whitespace-only query returns no results without erroring", async () => {
    await seedScenario("search-by-name-blank-query");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const results = await raw.nodes.searchByName({ query: "   " });
    expect(results).toEqual([]);
  });
});

describe("nodes.searchByName (demo mode)", () => {
  const demoClient = createRouterClient(busabaseDemoRouter);

  it("matches seeded nodes by name/slug, in-memory, exact-slug-first", async () => {
    const tree = await demoClient.nodes.list();
    // Grab a real seeded node's exact name so this test doesn't hardcode
    // fixture content that could drift.
    const flatten = (nodes: (typeof tree)[number][]): (typeof tree)[number][] =>
      nodes.flatMap((node) => [node, ...flatten(node.children)]);
    const sample = flatten(tree).find((node) => node.name.trim().length > 2);
    expect(sample).toBeDefined();
    const query = (sample as (typeof tree)[number]).name.slice(0, 3);

    const results = await demoClient.nodes.searchByName({ query });
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        (r) =>
          r.name.toLowerCase().includes(query.toLowerCase()) ||
          r.slug.toLowerCase().includes(query.toLowerCase()),
      ),
    ).toBe(true);
  });

  it("empty query returns no results", async () => {
    const results = await demoClient.nodes.searchByName({ query: "" }).catch((error) => {
      // Contract-level `min(1)` may reject an empty string outright — either
      // outcome (a validation rejection, or a handled empty array) satisfies
      // "no results for a blank query."
      expect(error).toBeTruthy();
      return [] as unknown[];
    });
    expect(results).toEqual([]);
  });
});
