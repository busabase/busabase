import { createHash } from "node:crypto";
/**
 * Unified grep runs its sources in two lanes side by side: files and nodes
 * (object storage) in one, prompts and records (Postgres) in the other.
 *
 * Production, 2026-11-07: an unscoped grep in a space with ~96k records
 * scanned 32k–54k of them in 10 s and left the rest `notReached`, while a
 * records-only grep in the same space scanned all of them in ~6 s. Records ran
 * third, after files and nodes had spent their slices waiting on storage.
 *
 * 1. A files source that takes its whole slice — or more than it is given (a
 *    storage read already in flight cannot be called back) — no longer costs
 *    records the time it needs.
 * 2. When everything completes, the matches and their order are exactly what
 *    one-after-another scanning returns: SOURCE_ORDER, then each source's own
 *    order, and each source cut to the share `sourceBudget` gives it — even
 *    though records now finishes before files does.
 *
 * The files source is wrapped so it can be made slow, and a record's scan can
 * be made to cost a fixed time per record, so the outcome depends on how the
 * call's time is shared, not on machine speed.
 */
import { createRouterClient } from "@orpc/server";
import type { UnifiedGrepMatchVO } from "busabase-contract/contract/grep-schemas";
import { storage } from "openlib/storage";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

const files = vi.hoisted(() => ({
  /**
   * `real`: the real files source. `delayed`: the real one after `delayMs`.
   * `slice`: spends its whole slice and finds nothing. `overshoot`: takes
   * `delayMs` whatever its slice, as an in-flight storage batch does.
   */
  mode: "real" as "real" | "delayed" | "slice" | "overshoot",
  delayMs: 0,
}));
/** Each scanned line holding `SLOW_MARK` costs this long. */
const slowScan = vi.hoisted(() => ({ perLineMs: 0 }));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

vi.mock("../src/domains/assets/logic/asset-grep-logic", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/domains/assets/logic/asset-grep-logic")>();
  const nothing = {
    matches: [],
    filesScanned: 0,
    missing: [],
    stale: [],
    unsearchable: 0,
    errored: [],
    notReached: 1,
    truncated: true,
  };
  return {
    ...actual,
    grepAssets: async (
      input: Parameters<typeof actual.grepAssets>[0],
      options: Parameters<typeof actual.grepAssets>[1] = {},
    ) => {
      if (files.mode === "delayed") {
        await sleep(files.delayMs);
        return actual.grepAssets(input, options);
      }
      if (files.mode === "slice") {
        await sleep((options.deadline ?? Date.now()) - Date.now());
        return nothing;
      }
      if (files.mode === "overshoot") {
        await sleep(files.delayMs);
        return nothing;
      }
      return actual.grepAssets(input, options);
    },
  };
});

vi.mock("../src/logic/text-scan-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/logic/text-scan-core")>();
  return {
    ...actual,
    scanLines: (
      lines: Parameters<typeof actual.scanLines>[0],
      opts: Parameters<typeof actual.scanLines>[1],
    ) => {
      if (slowScan.perLineMs === 0) return actual.scanLines(lines, opts);
      async function* slowed() {
        for await (const line of lines) {
          if (line.includes("LANESLOWMARK")) await sleep(slowScan.perLineMs);
          yield line;
        }
      }
      return actual.scanLines(slowed(), opts);
    },
  };
});

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const asManager = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true }, fn);

const TIMEOUT_MS = 4_000;
const SLOW_RECORDS = 20;
/** 20 records × 100 ms = 2 s: more than half the call, well within all of it. */
const PER_RECORD_MS = 100;

/** What identifies a match, whatever its source. */
const keyOf = (match: UnifiedGrepMatchVO): string => {
  if (match.source === "files") return `files:${match.assetId}:${match.line}`;
  if (match.source === "nodes") return `nodes:${match.nodeId}:${match.line}`;
  if (match.source === "records") {
    return `records:${match.recordId}:${match.fieldSlug}:${match.line}`;
  }
  return `prompts:${match.nodeId}:${match.key}:${match.field}:${match.locale}:${match.line}`;
};

describe("grep — storage-bound and Postgres-bound sources run side by side", () => {
  let raw: RawClient;
  let slowBaseId = "";
  let orderBaseId = "";
  let fileAssetId = "";
  let docNodeId = "";
  let promptNodeId = "";
  const orderRecordIds: string[] = [];

  const grep = (input: Parameters<RawClient["grep"]>[0]) => asManager(() => raw.grep(input));

  beforeAll(async () => {
    await seedScenario("grep-source-lanes");
    raw = createRouterClient(busabaseRouter);

    await asManager(async () => {
      // Records whose scan costs PER_RECORD_MS each.
      const slowBase = await raw.bases.create({
        slug: "lanes-slow",
        name: "Lanes Slow",
        fields: [{ slug: "title", name: "Title", type: "text" }],
        autoMerge: true,
      });
      if ("status" in slowBase) throw new Error("expected a materialized Base");
      slowBaseId = slowBase.id;
      for (let i = 0; i < SLOW_RECORDS; i++) {
        await raw.bases.createChangeRequest({
          baseId: slowBaseId,
          fields: { title: `LANESLOWMARK ${i}` },
          submittedBy: "agent",
          autoMerge: true,
        });
      }

      // One match source each, for the order test. 7 file lines, 3 doc lines,
      // 3 records × 10 lines, and 3 prompts with the marker in label and body.
      const bytes = Buffer.alloc(100, "c");
      const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const upload = await raw.assets.createUploadUrl({
        fileName: "order.log",
        mimeType: "text/plain",
        sizeBytes: 100,
        contentHash,
      });
      await storage.uploadFileToKey(bytes, upload.storageKey, "text/plain");
      const confirmed = await raw.assets.confirm({
        storageKey: upload.storageKey,
        fileName: "order.log",
        mimeType: "text/plain",
        sizeBytes: 100,
        contentHash,
      });
      if (!confirmed.assetId) throw new Error("confirm returned no assetId");
      fileAssetId = confirmed.assetId;
      await raw.assets.putText({
        assetId: fileAssetId,
        text: Array.from({ length: 7 }, (_, i) => `ORDERMARK file line ${i}`).join("\n"),
      });

      const doc = await raw.docs.create({
        slug: "lanes-order-doc",
        name: "Order Doc",
        body: ["intro", "ORDERMARK doc a", "ORDERMARK doc b", "plain", "ORDERMARK doc c"].join(
          "\n",
        ),
        autoMerge: true,
      });
      if (!("node" in doc)) throw new Error("expected a materialized Doc");
      docNodeId = doc.node.id;

      const orderBase = await raw.bases.create({
        slug: "lanes-order",
        name: "Lanes Order",
        fields: [{ slug: "notes", name: "Notes", type: "longtext" }],
        autoMerge: true,
      });
      if ("status" in orderBase) throw new Error("expected a materialized Base");
      orderBaseId = orderBase.id;
      for (let r = 0; r < 3; r++) {
        await raw.bases.createChangeRequest({
          baseId: orderBaseId,
          fields: {
            notes: Array.from({ length: 10 }, (_, i) => `ORDERMARK record ${r} line ${i}`).join(
              "\n",
            ),
          },
          submittedBy: "agent",
          autoMerge: true,
        });
      }
      // grep reads the most recently updated record first.
      const page = await raw.records.list({ baseId: orderBaseId, limit: 100 });
      orderRecordIds.push(
        ...[...page.records]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((record) => record.id),
      );
      expect(orderRecordIds).toHaveLength(3);

      const promptNode = await raw.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          { kind: "create", nodeType: "folder", slug: "lanes-prompts", name: "Lanes Prompts" },
        ],
      });
      expect(promptNode.status).toBe("merged");
      const tree = await raw.nodes.list();
      const flat = (nodes: typeof tree): typeof tree =>
        nodes.flatMap((node) => [node, ...flat(node.children)]);
      promptNodeId = flat(tree).find((node) => node.slug === "lanes-prompts")?.id ?? "";
      await raw.nodes.updateAgentPrompts({
        nodeId: promptNodeId,
        agentPrompts: [0, 1, 2].map((i) => ({
          key: `order-${i}`,
          label: `ORDERMARK prompt ${i}`,
          body: `Do the ORDERMARK step ${i}`,
        })),
      });
    });
    process.env.BUSABASE_GREP_TIMEOUT_MS = String(TIMEOUT_MS);
  }, 120_000);

  afterAll(() => {
    delete process.env.BUSABASE_GREP_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env.BUSABASE_GREP_TIMEOUT_MS = String(TIMEOUT_MS);
    files.mode = "real";
    files.delayMs = 0;
    slowScan.perLineMs = 0;
  });

  it("records get the whole call while files spends its whole slice", async () => {
    files.mode = "slice";
    slowScan.perLineMs = PER_RECORD_MS;
    const result = await grep({
      pattern: "LANESLOWMARK",
      maxMatches: 100,
      scope: { records: { baseIds: [slowBaseId] } },
    });
    // One-after-another, records got (4 s − 1 s of files) / 2 ≈ 1.5 s: ~15 of 20.
    expect(result.coverage.records).toEqual({
      scanned: SLOW_RECORDS,
      errored: [],
      notReached: 0,
    });
    expect(result.matches.filter((match) => match.source === "records")).toHaveLength(SLOW_RECORDS);
    // Files ran out of its slice and says so.
    expect(result.coverage.files.notReached).toBe(1);
    expect(result.truncated).toBe(true);
  }, 30_000);

  it("records are not left `scanned: 0` by a files source that overruns the whole call", async () => {
    files.mode = "overshoot";
    files.delayMs = TIMEOUT_MS + 200;
    slowScan.perLineMs = PER_RECORD_MS;
    const startedAt = Date.now();
    const result = await grep({
      pattern: "LANESLOWMARK",
      maxMatches: 100,
      scope: { records: { baseIds: [slowBaseId] } },
    });
    expect(result.coverage.records).toEqual({
      scanned: SLOW_RECORDS,
      errored: [],
      notReached: 0,
    });
    // The answer waits for the files source: nothing is left running behind it.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(TIMEOUT_MS + 200 - 20);
  }, 30_000);

  it("returns the same matches in the same order as one-after-another scanning", async () => {
    // Files finishes last, so records and prompts are in before it is. A
    // roomy deadline: this is about what comes back when nothing runs out.
    files.mode = "delayed";
    files.delayMs = 600;
    process.env.BUSABASE_GREP_TIMEOUT_MS = "30000";
    const all = await grep({ pattern: "ORDERMARK", maxMatches: 100 });

    expect(all.truncated).toBe(false);
    const bySource = (source: UnifiedGrepMatchVO["source"]) =>
      all.matches.filter((match) => match.source === source).map(keyOf);
    const expected = {
      files: Array.from({ length: 7 }, (_, i) => `files:${fileAssetId}:${i + 1}`),
      nodes: [2, 3, 5].map((line) => `nodes:${docNodeId}:${line}`),
      // Most recently updated record first, then line order.
      records: orderRecordIds.flatMap((recordId) =>
        Array.from({ length: 10 }, (_, i) => `records:${recordId}:notes:${i + 1}`),
      ),
      prompts: [0, 1, 2].flatMap((i) => [
        `prompts:${promptNodeId}:order-${i}:label:default:1`,
        `prompts:${promptNodeId}:order-${i}:body:default:1`,
      ]),
    };
    expect(bySource("files")).toEqual(expected.files);
    expect(bySource("nodes")).toEqual(expected.nodes);
    expect(bySource("records")).toEqual(expected.records);
    expect(bySource("prompts")).toEqual(expected.prompts);
    // SOURCE_ORDER, whichever source finished first.
    expect(all.matches.map(keyOf)).toEqual([
      ...expected.files,
      ...expected.nodes,
      ...expected.records,
      ...expected.prompts,
    ]);
    expect(all.coverage.records.notReached).toBe(0);
    expect(all.coverage.prompts.notReached).toBe(0);

    // maxMatches 20, floor 5: files 5 of 7; nodes 3 (share 5); records 7
    // (share 12 − 5 reserved for prompts); prompts the last 5. Records and
    // prompts ran before files and nodes had finished, with the most they
    // could be given (15 and 20), and were cut to those shares.
    const cut = await grep({ pattern: "ORDERMARK", maxMatches: 20 });
    expect(cut.matches.map(keyOf)).toEqual([
      ...expected.files.slice(0, 5),
      ...expected.nodes,
      ...expected.records.slice(0, 7),
      ...expected.prompts.slice(0, 5),
    ]);
    expect(cut.truncated).toBe(true);
  }, 60_000);

  it("a source cut to its share still reports `truncated`", async () => {
    await asManager(async () => {
      const bytes = Buffer.alloc(100, "d");
      const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const upload = await raw.assets.createUploadUrl({
        fileName: "cut.log",
        mimeType: "text/plain",
        sizeBytes: 100,
        contentHash,
      });
      await storage.uploadFileToKey(bytes, upload.storageKey, "text/plain");
      const confirmed = await raw.assets.confirm({
        storageKey: upload.storageKey,
        fileName: "cut.log",
        mimeType: "text/plain",
        sizeBytes: 100,
        contentHash,
      });
      if (!confirmed.assetId) throw new Error("confirm returned no assetId");
      await raw.assets.putText({
        assetId: confirmed.assetId,
        text: Array.from({ length: 4 }, (_, i) => `CUTMARK file ${i}`).join("\n"),
      });
      await raw.docs.create({
        slug: "lanes-cut-doc",
        name: "Cut Doc",
        body: Array.from({ length: 4 }, (_, i) => `CUTMARK doc ${i}`).join("\n"),
        autoMerge: true,
      });
      const base = await raw.bases.create({
        slug: "lanes-cut",
        name: "Lanes Cut",
        fields: [{ slug: "notes", name: "Notes", type: "longtext" }],
        autoMerge: true,
      });
      if ("status" in base) throw new Error("expected a materialized Base");
      await raw.bases.createChangeRequest({
        baseId: base.id,
        fields: { notes: Array.from({ length: 10 }, (_, i) => `CUTMARK record ${i}`).join("\n") },
        submittedBy: "agent",
        autoMerge: true,
      });
    });

    files.mode = "delayed";
    files.delayMs = 600;
    process.env.BUSABASE_GREP_TIMEOUT_MS = "30000";
    const result = await grep({ pattern: "CUTMARK", maxMatches: 20 });
    // maxMatches 20, floor 5: files 4 (share 5) and nodes 4 (share 6) both
    // finish under their shares, so neither is truncated. Records' share is 7
    // (12 left − 5 kept for prompts); it ran before files had finished, with
    // 15, found all 10 and was cut to 7 — and the cut alone says "there is more".
    const count = (source: UnifiedGrepMatchVO["source"]) =>
      result.matches.filter((match) => match.source === source).length;
    expect([count("files"), count("nodes"), count("records"), count("prompts")]).toEqual([
      4, 4, 7, 0,
    ]);
    expect(result.truncated).toBe(true);
  }, 60_000);
});
