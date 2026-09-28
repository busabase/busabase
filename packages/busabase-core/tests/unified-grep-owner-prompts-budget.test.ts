/**
 * Unified grep, item D of agent-playbook-discovery.md §9 — against a real
 * PGLite database through the real oRPC router (plus one pass through the
 * OpenAPI handler for the `/api/v1` boundary):
 *
 * 1. `files` matches carry `owner` (which skill/drive a hit belongs to).
 * 2. The `prompts` source scans custom agent prompts, every locale.
 * 3. Fair budget: every requested source gets a floor of the shared budget,
 *    so one noisy source can no longer starve the rest.
 * 4. A file whose only usage is on an archived node is not returned.
 */
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import type { UnifiedGrepResultVO } from "busabase-contract/contract/grep-schemas";
import type { CustomAgentPrompts } from "busabase-contract/contract/node-agent-prompt-schemas";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseAssetUsages, busabaseNodes } from "../src/db/schema";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
type Db = Awaited<ReturnType<typeof seedScenario>>["db"];

const asManager = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true }, fn);

const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

describe("unified grep — owner, prompts source, fair budget, archived owners", () => {
  let raw: RawClient;
  let db: Db;

  beforeAll(async () => {
    ({ db } = await seedScenario("grep-owner-prompts-budget"));
    raw = createRouterClient(busabaseRouter);
  });

  const grep = (input: Parameters<RawClient["grep"]>[0]) => asManager(() => raw.grep(input));

  /** Create nodes in one merged change request and return `slug -> nodeId`. */
  const createNodes = async (
    operations: Parameters<RawClient["nodes"]["createChangeRequest"]>[0]["operations"],
  ): Promise<Map<string, string>> =>
    asManager(async () => {
      const cr = await raw.nodes.createChangeRequest({ autoMerge: true, operations });
      expect(cr.status).toBe("merged");
      const tree = await raw.nodes.list();
      const flat = (nodes: typeof tree): typeof tree =>
        nodes.flatMap((node) => [node, ...flat(node.children)]);
      return new Map(flat(tree).map((node) => [node.slug, node.id]));
    });

  const idOf = (ids: Map<string, string>, slug: string): string => {
    const id = ids.get(slug);
    if (!id) throw new Error(`fixture node ${slug} was not created`);
    return id;
  };

  const archiveNode = (nodeId: string) =>
    asManager(async () => {
      const cr = await raw.nodes.createChangeRequest({
        operations: [{ kind: "delete", nodeId }],
        autoMerge: true,
      });
      expect(cr.status).toBe("merged");
    });

  /** Upload+confirm+putText an unmounted text asset. */
  const seedFile = (opts: { fileName: string; hashByte: string; text: string }) =>
    asManager(async () => {
      const contentHash = HASH(opts.hashByte);
      const req = await raw.assets.createUploadUrl({
        fileName: opts.fileName,
        mimeType: "text/plain",
        sizeBytes: 100,
        contentHash,
      });
      const confirmed = await raw.assets.confirm({
        storageKey: req.storageKey,
        fileName: opts.fileName,
        mimeType: "text/plain",
        sizeBytes: 100,
        contentHash,
      });
      const assetId = confirmed.assetId;
      if (!assetId) throw new Error("confirm returned no assetId");
      await raw.assets.putText({ assetId, text: opts.text });
      return assetId;
    });

  const fileMatches = (result: UnifiedGrepResultVO) =>
    result.matches.flatMap((match) => (match.source === "files" ? [match] : []));

  // ── 1. owner attribution ──────────────────────────────────────────────────

  it("a SKILL.md hit names the skill it belongs to and the folder path above it", async () => {
    const ids = await createNodes([
      { kind: "create", nodeType: "folder", slug: "owner-sales", name: "Sales", ref: "sales" },
      {
        kind: "create",
        nodeType: "folder",
        slug: "owner-reports",
        name: "Reports",
        ref: "reports",
        parentNodeRef: "sales",
      },
      {
        kind: "create",
        nodeType: "skill",
        slug: "owner-weekly-report",
        name: "Weekly Report",
        description: "OWNERMARKER compile the weekly sales report",
        parentNodeRef: "reports",
      },
    ]);
    const skillId = idOf(ids, "owner-weekly-report");

    const result = await grep({ pattern: "OWNERMARKER", sources: ["files"] });

    // The description lands in SKILL.md (frontmatter + body) and skill.json —
    // every one of those hits must say which skill it is in.
    const hits = fileMatches(result);
    expect(hits.map((hit) => hit.fileName)).toContain("SKILL.md");
    for (const hit of hits) {
      expect(hit.owner).toEqual({
        nodeId: skillId,
        nodeType: "skill",
        nodeName: "Weekly Report",
        path: ["Sales", "Reports"],
      });
    }

    // The same owner through the real `/api/v1` handler (JSON over HTTP).
    const handler = new OpenAPIHandler(busabaseRouter);
    const http = await asManager(() =>
      handler.handle(
        new Request("http://busabase.test/api/v1/grep", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pattern: "OWNERMARKER", sources: ["files"] }),
        }),
        { context: {} },
      ),
    );
    if (!http.matched) throw new Error("POST /grep matched no route");
    expect(http.response.status).toBe(200);
    const body = (await http.response.json()) as UnifiedGrepResultVO;
    expect(fileMatches(body)[0]?.owner?.nodeName).toBe("Weekly Report");
  });

  it("with several usages, owner is the usage under the requested drivePath, else the first one", async () => {
    const ids = await createNodes([
      {
        kind: "create",
        nodeType: "skill",
        slug: "multi-usage-skill",
        name: "Multi Usage Skill",
        description: "MULTIUSAGEMARKER shared file",
      },
      { kind: "create", nodeType: "drive", slug: "multi-usage-drive", name: "Team Drive" },
    ]);
    const skillId = idOf(ids, "multi-usage-skill");
    const driveId = idOf(ids, "multi-usage-drive");

    const [skillUsage] = await db
      .select()
      .from(busabaseAssetUsages)
      .where(
        and(eq(busabaseAssetUsages.nodeId, skillId), eq(busabaseAssetUsages.path, "SKILL.md")),
      );
    if (!skillUsage) throw new Error("skill has no SKILL.md usage row");
    // A second, later mount of the same asset in a Drive.
    await db.insert(busabaseAssetUsages).values({
      id: "aus_multi_usage_drive",
      spaceId: skillUsage.spaceId,
      assetId: skillUsage.assetId,
      ownerType: "drive",
      nodeId: driveId,
      path: "mirror/SKILL-copy.md",
      createdAt: new Date(Date.now() + 60_000),
    });

    const unscoped = await grep({
      pattern: "MULTIUSAGEMARKER",
      sources: ["files"],
      scope: { files: { assetIds: [skillUsage.assetId] } },
    });
    expect(fileMatches(unscoped).length).toBeGreaterThan(0);
    for (const hit of fileMatches(unscoped)) expect(hit.owner?.nodeId).toBe(skillId);

    const scoped = await grep({
      pattern: "MULTIUSAGEMARKER",
      sources: ["files"],
      scope: { files: { drivePath: "mirror/" } },
    });
    expect(fileMatches(scoped).length).toBeGreaterThan(0);
    for (const hit of fileMatches(scoped)) {
      expect(hit.owner).toMatchObject({
        nodeId: driveId,
        nodeType: "drive",
        nodeName: "Team Drive",
      });
      expect(hit.drivePath).toBe("mirror/SKILL-copy.md");
    }
  });

  it("an unmounted staging upload has no owner", async () => {
    await seedFile({ fileName: "staging.txt", hashByte: "a", text: "STAGINGOWNERMARKER here" });
    const result = await grep({ pattern: "STAGINGOWNERMARKER", sources: ["files"] });
    const hits = fileMatches(result);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.owner).toBeUndefined();
  });

  // ── 4. archived owners ────────────────────────────────────────────────────

  it("does not return a file whose only usage is on an archived node (no drivePath given)", async () => {
    const ids = await createNodes([
      {
        kind: "create",
        nodeType: "skill",
        slug: "archived-owner-skill",
        name: "Retired Skill",
        description: "ARCHIVEDOWNERMARKER retired procedure",
      },
    ]);
    const skillId = idOf(ids, "archived-owner-skill");

    const before = await grep({ pattern: "ARCHIVEDOWNERMARKER", sources: ["files"] });
    expect(fileMatches(before).length).toBeGreaterThan(0);

    await archiveNode(skillId);
    const [node] = await db
      .select({ archivedAt: busabaseNodes.archivedAt })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, skillId));
    expect(node?.archivedAt).not.toBeNull();

    const after = await grep({ pattern: "ARCHIVEDOWNERMARKER", sources: ["files"] });
    expect(fileMatches(after)).toHaveLength(0);
    // Excluded from the candidate set, not scanned-and-hidden.
    expect(after.coverage.files.scanned).toBeLessThan(before.coverage.files.scanned);
  });

  // ── 2. prompts source ─────────────────────────────────────────────────────

  const PROMPTS: CustomAgentPrompts = [
    {
      key: "log-visit",
      label: { en: "Log a customer visit", "zh-CN": "记录客户拜访 PROMPTMARKER" },
      body: {
        en: "Add one record to {target}.\nThen note the PROMPTMARKER next step.",
        "zh-CN": "在 {target} 里新增一条记录。",
      },
    },
    { key: "plain", label: "Plain prompt", body: "PROMPTMARKER in a plain string body" },
  ];

  it("scans custom prompt labels and bodies in every locale, with line/column/locale/field", async () => {
    const ids = await createNodes([
      {
        kind: "create",
        nodeType: "base",
        slug: "prompt-visits",
        name: "Visits",
        fields: [{ slug: "title", name: "Title", type: "text" }],
      },
    ]);
    const nodeId = idOf(ids, "prompt-visits");
    await asManager(() => raw.nodes.updateAgentPrompts({ nodeId, agentPrompts: PROMPTS }));

    const result = await grep({ pattern: "PROMPTMARKER", sources: ["prompts"], contextLines: 1 });

    const hits = result.matches.flatMap((match) => (match.source === "prompts" ? [match] : []));
    expect(hits).toHaveLength(3);
    expect(hits.map((hit) => [hit.key, hit.field, hit.locale, hit.line, hit.column])).toEqual([
      ["log-visit", "label", "zh-CN", 1, 8],
      ["log-visit", "body", "en", 2, 15],
      ["plain", "body", "default", 1, 1],
    ]);
    expect(hits[0]).toMatchObject({
      source: "prompts",
      nodeId,
      nodeName: "Visits",
      nodeType: "base",
      text: "记录客户拜访 PROMPTMARKER",
    });
    // The human label, in the locale that matched (a key is an identifier).
    expect(hits.map((hit) => hit.label)).toEqual([
      "记录客户拜访 PROMPTMARKER",
      "Log a customer visit",
      "Plain prompt",
    ]);
    expect(hits[1]?.before).toEqual(["Add one record to {target}."]);
    expect(result.coverage.prompts).toEqual({ scanned: 1, errored: [], notReached: 0 });

    // Default sources include prompts.
    const everything = await grep({ pattern: "PROMPTMARKER" });
    expect(everything.matches.filter((match) => match.source === "prompts")).toHaveLength(3);
    expect(everything.coverage.prompts?.scanned).toBe(1);

    // Archived nodes' prompts are not scanned.
    await archiveNode(nodeId);
    const archived = await grep({ pattern: "PROMPTMARKER", sources: ["prompts"] });
    expect(archived.matches).toHaveLength(0);
    expect(archived.coverage.prompts?.scanned).toBe(0);
  });

  it("reports a stored prompt list that fails validation as errored, not as a clean miss", async () => {
    const ids = await createNodes([
      { kind: "create", nodeType: "folder", slug: "prompt-corrupt", name: "Corrupt" },
    ]);
    const nodeId = idOf(ids, "prompt-corrupt");
    await db
      .update(busabaseNodes)
      .set({ agentPrompts: [{ nope: true }] as unknown as CustomAgentPrompts })
      .where(eq(busabaseNodes.id, nodeId));

    const result = await grep({ pattern: "anything", sources: ["prompts"] });
    expect(result.coverage.prompts?.errored).toContain(nodeId);
  });

  // ── 3. fair budget ────────────────────────────────────────────────────────

  it("200 file hits cannot starve records: with maxMatches 20, the 5 record hits still appear", async () => {
    const marker = "FAIRBUDGETMARKER";
    await seedFile({
      fileName: "noisy.log",
      hashByte: "b",
      text: Array.from({ length: 200 }, (_, i) => `${marker} line ${i}`).join("\n"),
    });
    const base = await asManager(() =>
      raw.bases.create({
        slug: "fair-budget-base",
        name: "Fair Budget",
        fields: [{ slug: "notes", name: "Notes", type: "text" }],
        autoMerge: true,
      }),
    );
    if ("status" in base) throw new Error("expected a materialized Base");
    for (let i = 0; i < 5; i++) {
      await asManager(async () => {
        await raw.bases.createChangeRequest({
          baseId: base.id,
          fields: { notes: `${marker} record ${i}` },
          submittedBy: "agent",
          autoMerge: true,
        });
      });
    }

    const result = await grep({ pattern: marker, maxMatches: 20 });

    const bySource = (source: string) => result.matches.filter((m) => m.source === source).length;
    expect(bySource("records")).toBe(5);
    expect(bySource("files")).toBeGreaterThanOrEqual(5); // floor(20 / 4 sources)
    expect(result.matches.length).toBeLessThanOrEqual(20);
    expect(result.truncated).toBe(true);
    // Deterministic order is kept: every file match before every record match.
    const sources = result.matches.map((m) => m.source);
    expect(sources.lastIndexOf("files")).toBeLessThan(sources.indexOf("records"));

    // Two sources: the floor is 10 each, and records' unused 5 do not go backwards.
    const two = await grep({ pattern: marker, sources: ["files", "records"], maxMatches: 20 });
    expect(two.matches.filter((m) => m.source === "files")).toHaveLength(10);
    expect(two.matches.filter((m) => m.source === "records")).toHaveLength(5);
  });

  it("unused budget rolls forward to later sources", async () => {
    const marker = "ROLLFORWARDMARKER";
    const base = await asManager(() =>
      raw.bases.create({
        slug: "roll-forward-base",
        name: "Roll Forward",
        fields: [{ slug: "notes", name: "Notes", type: "text" }],
        autoMerge: true,
      }),
    );
    if ("status" in base) throw new Error("expected a materialized Base");
    await asManager(async () => {
      await raw.bases.createChangeRequest({
        baseId: base.id,
        fields: { notes: Array.from({ length: 30 }, (_, i) => `${marker} ${i}`).join("\n") },
        submittedBy: "agent",
        autoMerge: true,
      });
    });

    // No file or node contains the marker, so their unused floors (5 + 5) roll
    // forward to records: 5 + 10 = 15. Prompts' floor (5) stays reserved —
    // budget only rolls forward, never back.
    const result = await grep({ pattern: marker, maxMatches: 20 });
    expect(result.matches).toHaveLength(15);
    expect(result.matches.every((m) => m.source === "records")).toBe(true);
    expect(result.truncated).toBe(true);

    // With records last, it gets everything files left.
    const two = await grep({ pattern: marker, sources: ["files", "records"], maxMatches: 20 });
    expect(two.matches).toHaveLength(20);
    expect(two.matches.every((m) => m.source === "records")).toBe(true);
  });

  it("maxMatches smaller than the source count never overshoots and reports the unreached sources honestly", async () => {
    const result = await grep({ pattern: "FAIRBUDGETMARKER", maxMatches: 1 });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.source).toBe("files");
    expect(result.truncated).toBe(true);
    // Records had budget 0 left, so none of its candidates were reached.
    expect(result.coverage.records.notReached).toBeGreaterThan(0);
  });
});
