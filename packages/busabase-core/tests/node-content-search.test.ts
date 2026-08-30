/**
 * Node content search (`search({ sources: ["nodes"] })`) — the human-facing
 * counterpart to grep's `nodes` source.
 *
 * The gap these cover: before this feature a user could not find a Doc by a
 * phrase in its body, only by its title, while an agent's `grep` found it
 * immediately. Driven through the real oRPC router (real temp PGLite + real
 * local storage), same harness as `unified-grep.test.ts`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VALUE_TEXT_INDEX_LIMIT } from "../src/logic/vo";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Node content search", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-nodesearch-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-nodesearch-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const seedDoc = async (slug: string, name: string, body: string) => {
    const doc = await client.docs.create({ autoMerge: true, slug, name, body });
    if (!("node" in doc)) throw new Error("expected a materialized DocVO");
    return doc.node.id;
  };

  const seedRich = async (
    nodeType: "html" | "whiteboard" | "workflow",
    slug: string,
    content: Parameters<Client["nodes"]["updateContent"]>[0]["content"],
  ) => {
    const rootId = (await client.nodes.list({}))[0]?.id ?? "";
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "create", parentNodeId: rootId, nodeType, slug, name: slug }],
    });
    const flatten = (e: Awaited<ReturnType<Client["nodes"]["list"]>>): typeof e =>
      e.flatMap((x) => [x, ...flatten(x.children)]);
    const nodeId = flatten(await client.nodes.list({})).find((n) => n.slug === slug)?.id ?? "";
    expect(nodeId).not.toBe("");
    await client.nodes.updateContent({ nodeId, content, autoMerge: true });
    return nodeId;
  };

  const searchNodes = (query: string) =>
    client.search({ query, limit: 20, offset: 0, sources: ["nodes"] });

  it("finds a Doc by a phrase in its BODY, not just its title", async () => {
    // The exact shape of the original complaint: the phrase is in the body and
    // deliberately NOT in the title, so a title-only search cannot find it.
    const nodeId = await seedDoc(
      "pricing-plan",
      "Q3 Planning",
      "# Notes\n\nOur BODYNEEDLE strategy for the launch.\n",
    );

    const result = await searchNodes("BODYNEEDLE");
    const hit = result.results.find((r) => r.id === nodeId);
    expect(hit, "the Doc containing the phrase must be found").toBeDefined();
    expect(hit?.kind).toBe("node");
    expect(hit?.title).toBe("Q3 Planning");
    // A snippet, so a user can tell near-identical docs apart (spec S1).
    expect(hit?.body).toContain("BODYNEEDLE");
  });

  it("agrees with grep: the same phrase is found by both surfaces", async () => {
    const nodeId = await seedDoc("parity-doc", "Parity", "PARITYNEEDLE lives here\n");
    const [searched, grepped] = await Promise.all([
      searchNodes("PARITYNEEDLE"),
      client.grep({ pattern: "PARITYNEEDLE", sources: ["nodes"] }),
    ]);
    expect(searched.results.some((r) => r.id === nodeId)).toBe(true);
    expect(
      grepped.matches.some((m) => m.source === "nodes" && m.nodeId === nodeId),
      "search and grep must not disagree about what the workspace contains",
    ).toBe(true);
  });

  it("finds html source text", async () => {
    const nodeId = await seedRich("html", "pricing-page", {
      kind: "html",
      document: { version: 1, source: "<html><body><h1>HTMLBODYNEEDLE</h1></body></html>\n" },
    });
    const result = await searchNodes("HTMLBODYNEEDLE");
    expect(result.results.some((r) => r.id === nodeId)).toBe(true);
  });

  it("finds whiteboard text without matching Excalidraw's JSON keys", async () => {
    const nodeId = await seedRich("whiteboard", "launch-board", {
      kind: "whiteboard",
      document: {
        version: 1,
        elements: [
          {
            id: "t1",
            type: "text",
            isDeleted: false,
            strokeColor: "#0f172a",
            originalText: "BOARDBODYNEEDLE plan",
          },
        ],
        appState: {},
      },
    });

    expect((await searchNodes("BOARDBODYNEEDLE")).results.some((r) => r.id === nodeId)).toBe(true);

    // The whole reason extraction exists: a structural key that IS present in
    // the stored object must not be searchable.
    const noise = await searchNodes("strokeColor");
    expect(noise.results.some((r) => r.id === nodeId)).toBe(false);
  });

  it("makes an approved edit searchable immediately — no indexing lag", async () => {
    const nodeId = await seedDoc("fresh-doc", "Fresh", "before the edit\n");
    await client.nodes.updateContent({
      nodeId,
      autoMerge: true,
      content: { kind: "doc", body: "FRESHNEEDLE after the edit\n" },
    });
    // No sleep, no polling: the projection is written in the merge transaction.
    const result = await searchNodes("FRESHNEEDLE");
    expect(result.results.some((r) => r.id === nodeId)).toBe(true);
  });

  it("stops finding content that was edited away", async () => {
    const nodeId = await seedDoc("stale-doc", "Stale", "GONENEEDLE is here\n");
    expect((await searchNodes("GONENEEDLE")).results.some((r) => r.id === nodeId)).toBe(true);
    await client.nodes.updateContent({
      nodeId,
      autoMerge: true,
      content: { kind: "doc", body: "the phrase is gone now\n" },
    });
    expect((await searchNodes("GONENEEDLE")).results.some((r) => r.id === nodeId)).toBe(false);
  });

  it("does not index an unapproved ChangeRequest's content", async () => {
    const nodeId = await seedDoc("pending-doc", "Pending", "approved text only\n");
    const cr = await client.nodes.updateContent({
      nodeId,
      autoMerge: false, // review-first: never merged below
      content: { kind: "doc", body: "PENDINGNEEDLE not approved\n" },
    });
    expect(cr.status).toBe("in_review");
    // Search reflects the APPROVED state of the workspace (spec S5).
    expect((await searchNodes("PENDINGNEEDLE")).results).toHaveLength(0);
  });

  it("excludes an archived node's content", async () => {
    const nodeId = await seedDoc("archived-doc", "Archived", "ARCHIVEDNEEDLE here\n");
    expect((await searchNodes("ARCHIVEDNEEDLE")).results.some((r) => r.id === nodeId)).toBe(true);

    const cr = await client.nodes.createChangeRequest({
      operations: [{ kind: "delete", nodeId }],
      autoMerge: false,
    });
    await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [cr.id] });

    expect((await searchNodes("ARCHIVEDNEEDLE")).results.some((r) => r.id === nodeId)).toBe(false);
  });

  it("reports contentTruncated so an empty result is never misread as absence", async () => {
    // Past the projection cap by construction.
    const filler = "x".repeat(VALUE_TEXT_INDEX_LIMIT + 500);
    const nodeId = await seedDoc("long-doc", "Long", `${filler}\nTAILNEEDLE past the cap\n`);

    const result = await searchNodes("TAILNEEDLE");
    // The term itself is beyond the cap, so it is genuinely not findable...
    expect(result.results.some((r) => r.id === nodeId)).toBe(false);
    // ...but the caller is TOLD coverage was partial rather than being left to
    // conclude the workspace does not contain it (spec D2b / Principle #1).
    expect(result.contentTruncated).toBe(true);
  });

  it("finds Chinese content — which rides entirely on the trigram/ilike branch", async () => {
    // Postgres has no CJK segmenter: `to_tsvector('simple', …)` turns a whole
    // Chinese run into ONE oversized lexeme, so the tsvector branch scores zero
    // here and the ilike branch is what actually works (spec D2a). If someone
    // ever "optimizes away" that branch or its trigram index, this goes red.
    const nodeId = await seedDoc("zh-doc", "中文文档", "我们的定价策略与上线计划的评审记录。\n");
    const result = await searchNodes("定价策略");
    expect(result.results.some((r) => r.id === nodeId)).toBe(true);
  });

  // ── Pre-existing content (the upgrade path) ───────────────────────────────
  // Every node that existed before this feature shipped has no projection row.
  // Deleting the row simulates exactly that state, because it is the same
  // state: a content-bearing node whose content is in storage and whose
  // projection is absent.

  it("indexes a node that predates the feature — deleting its row is the upgrade state", async () => {
    const nodeId = await seedDoc("legacy-doc", "Legacy", "LEGACYNEEDLE written long ago\n");
    expect((await searchNodes("LEGACYNEEDLE")).results.some((r) => r.id === nodeId)).toBe(true);

    // Wipe the projection: this node is now indistinguishable from one created
    // before busabase_node_content_search existed.
    const { getDb } = await import("../src/db");
    const { busabaseNodeContentSearch } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    await db.delete(busabaseNodeContentSearch).where(eq(busabaseNodeContentSearch.nodeId, nodeId));
    const [gone] = await db
      .select()
      .from(busabaseNodeContentSearch)
      .where(eq(busabaseNodeContentSearch.nodeId, nodeId));
    expect(gone, "projection row must really be gone before we test the heal").toBeUndefined();

    // Searching re-indexes it from storage. No migration, no operator step:
    // the search that would have missed it is the one that repairs it.
    const healed = await searchNodes("LEGACYNEEDLE");
    expect(healed.results.some((r) => r.id === nodeId)).toBe(true);

    const [row] = await db
      .select()
      .from(busabaseNodeContentSearch)
      .where(eq(busabaseNodeContentSearch.nodeId, nodeId));
    expect(row?.contentText).toContain("LEGACYNEEDLE");
  });

  it("does not return node content when the caller did not ask for that source", async () => {
    const nodeId = await seedDoc("scoped-doc", "Scoped", "SCOPEDNEEDLE body\n");
    const recordsOnly = await client.search({
      query: "SCOPEDNEEDLE",
      limit: 20,
      offset: 0,
      sources: ["records"],
    });
    expect(recordsOnly.results.some((r) => r.id === nodeId)).toBe(false);
  });
});
