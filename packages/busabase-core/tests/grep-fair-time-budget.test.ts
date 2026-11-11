import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Unified grep shares its time the way it shares `maxMatches`.
 *
 * Every source used to scan against the call's one deadline, so the first slow
 * source spent all of it: in a space with 100k+ files and 70k records, an
 * unscoped grep answered with records `scanned: 0`. Now files and nodes run in
 * one lane and prompts and records in another, side by side; within a lane
 * each source gets an even slice of the time left, and time it does not use
 * rolls forward (see `tests/grep-source-lanes.test.ts` for the lanes).
 *
 * The files source is replaced by a fake that either spends its whole slice
 * (a space full of files) or returns at once, and the deadline every scan of a
 * record receives is recorded, so both behaviours are observable without
 * depending on machine speed.
 */

const files = vi.hoisted(() => ({
  mode: "fast" as "fast" | "slow",
  deadlines: [] as number[],
}));
const recordScans = vi.hoisted(() => [] as Array<{ at: number; deadline: number }>);

vi.mock("../src/domains/assets/logic/asset-grep-logic", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/domains/assets/logic/asset-grep-logic")>();
  return {
    ...actual,
    grepAssets: async (_input: unknown, options: { deadline?: number } = {}) => {
      const deadline = options.deadline ?? Date.now();
      files.deadlines.push(deadline);
      if (files.mode === "slow") {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())));
      }
      return {
        matches: [],
        filesScanned: 0,
        missing: [],
        stale: [],
        unsearchable: 0,
        errored: [],
        notReached: files.mode === "slow" ? 1 : 0,
        truncated: files.mode === "slow",
      };
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
      recordScans.push({ at: Date.now(), deadline: opts.deadline });
      return actual.scanLines(lines, opts);
    },
  };
});

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const TIMEOUT_MS = 1_500;
const RECORDS = 3;

describe("grep — each source gets a fair share of the time", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-time-budget-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-time-budget-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "grep-time-budget",
      name: "Time Budget",
      fields: [{ slug: "title", name: "Title", type: "text" }],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    baseId = base.id;
    for (let i = 0; i < RECORDS; i++) {
      const cr = await client.bases.createChangeRequest({
        baseId,
        fields: { title: `TIMEBUDGETNEEDLE ${i}` },
        submittedBy: "agent",
        autoMerge: false,
      });
      await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [cr.id] });
    }
    process.env.BUSABASE_GREP_TIMEOUT_MS = String(TIMEOUT_MS);
  }, 60_000);

  afterEach(() => {
    files.deadlines.length = 0;
    recordScans.length = 0;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    delete process.env.BUSABASE_GREP_TIMEOUT_MS;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("still scans records after a files source that uses all the time it is given", async () => {
    files.mode = "slow";
    const result = await client.grep({
      pattern: "TIMEBUDGETNEEDLE",
      sources: ["files", "records"],
      scope: { records: { baseIds: [baseId] } },
    });
    expect(result.coverage.records).toEqual({ scanned: RECORDS, errored: [], notReached: 0 });
    expect(result.matches.filter((match) => match.source === "records")).toHaveLength(RECORDS);
    // Files ran out of its own slice, and says so.
    expect(result.coverage.files.notReached).toBe(1);
    expect(result.truncated).toBe(true);
  }, 30_000);

  it("gives a later source in its lane the time an earlier one did not use", async () => {
    files.mode = "fast";
    const startedAt = Date.now();
    await client.grep({
      pattern: "TIMEBUDGETNEEDLE",
      scope: { records: { baseIds: [baseId] } },
    });
    // Files shares its lane with nodes: it was offered half of the call.
    const [filesDeadline] = files.deadlines;
    expect(filesDeadline - startedAt).toBeLessThanOrEqual(TIMEOUT_MS / 2 + 100);
    // Records shares its lane with prompts, which goes first and returns at
    // once, so records gets nearly the whole call — not a fixed half that
    // would leave prompts' unused time on the table.
    const [firstRecordScan] = recordScans;
    expect(firstRecordScan).toBeDefined();
    expect(firstRecordScan.deadline - firstRecordScan.at).toBeGreaterThan(TIMEOUT_MS * 0.8);
  }, 30_000);
});
