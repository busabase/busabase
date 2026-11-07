import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseCommits } from "../src/db/schema";
import { busabaseRecords } from "../src/domains/base/schema";
import { deriveRecordPrefilter } from "../src/logic/grep-record-prefilter";
import { compileGrepPattern } from "../src/logic/text-scan-core";
import { busabaseRouter } from "../src/router";

/**
 * Records grep must answer exactly the same with the Postgres prefilter as
 * without it. The prefilter searches `payload::text`; grep regex-scans each
 * field's flattened text — and the two differ (array joins, JSON spacing,
 * number renderings, string escaping, case folding, `[object Object]`). This
 * corpus puts a record on each of those differences and greps it with
 * patterns that land on them, comparing the whole response with the
 * prefilter on and off (`BUSABASE_GREP_RECORDS_PREFILTER=off`).
 *
 * Mutation check: dropping any one of the derivation's hazard rules
 * (`logic/grep-record-prefilter.ts`, rules 1 and 3–8) makes this file fail,
 * because the corpus then has a record the prefilter drops but grep matches.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
type GrepInput = Parameters<Client["grep"]>[0];

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
/** Two prefiltered batches (2,000 each), so order and coverage cross a batch boundary. */
const FILLER_RECORDS = 3_000;
const INSERT_CHUNK = 500;
const LONG_LINE_PADDING = "x".repeat(9_000);

/**
 * Raw jsonb text per tricky record — raw, so numbers keep the exact text a
 * client wrote (`1e21`, `12345678901234567891`), which jsonb then normalizes.
 */
const TRICKY_PAYLOADS: Record<string, string> = {
  caseAndCjk: JSON.stringify({
    title: "Quarterly PLAN review",
    notes:
      "Line one\nsecond line has 项目周报 and 季度计划\nthird line: CAFÉ ＡＢＣ\nfourth line\nfifth line",
    amount: 42,
    done: true,
  }),
  escapes: JSON.stringify({
    title: 'He said "hi" to C:\\temp',
    notes: 'backslash \\ path\nquote " end\ntab\there\ncol1\tcol2',
  }),
  arrays: JSON.stringify({ tags: ["alpha", "beta", "gamma delta"], extra: ["x", "foo"] }),
  arrayNulls: JSON.stringify({ tags: [" ", null, "foo"], amount: 0.1 }),
  arrayOfObjects: JSON.stringify({ extra: [{ a: 1 }, { b: "two" }] }),
  objectInTextField: JSON.stringify({ extra: { k: "v w", n: 1e-7 } }),
  jsonField: JSON.stringify({ meta: { a: 1, list: [1, 2], s: 'say "x"', deep: { y: null } } }),
  exponentLarge: '{"amount": 1e21}',
  exponentSmall: '{"amount": 1.5e-7}',
  manyDigits: '{"amount": 12345678901234567891}',
  numbersInArray: '{"extra": [1e21, 2]}',
  longLine: JSON.stringify({ notes: `SHALLOWNEEDLE ${LONG_LINE_PADDING} DEEPNEEDLE` }),
  notScanned: JSON.stringify({ ghost: "GHOSTNEEDLE", files: "ATTACHNEEDLE" }),
  unicode: JSON.stringify({ notes: "😀 smile\nſtop here\nKELVIN scale\nmixed Straße" }),
  dates: JSON.stringify({ title: "2024-01-15 release e2e INV-0042", when: "2024-01-15" }),
};

/** pattern, flags, whether the prefilter engages, and whether the corpus must contain a match. */
const CASES: Array<{ pattern: string; flags?: string; prefilter: boolean; hits: boolean }> = [
  // Plain literals and alternations — prefiltered.
  { pattern: "Quarterly PLAN", prefilter: true, hits: true },
  { pattern: "quarterly plan", flags: "i", prefilter: true, hits: true },
  { pattern: "quarterly plan", prefilter: true, hits: false },
  { pattern: "项目周报", prefilter: true, hits: true },
  { pattern: "季度|周报", prefilter: true, hits: true },
  { pattern: "周报 and", prefilter: true, hits: true },
  { pattern: "gamma delta", prefilter: true, hits: true },
  { pattern: "v w", prefilter: true, hits: true },
  { pattern: "temp", prefilter: true, hits: true },
  { pattern: "backslash", prefilter: true, hits: true },
  { pattern: "true|alpha", prefilter: true, hits: true },
  { pattern: "null", prefilter: true, hits: true },
  { pattern: "2024-01-15", prefilter: true, hits: true },
  { pattern: "e2e", prefilter: true, hits: true },
  { pattern: "INV-0042", prefilter: true, hits: true },
  { pattern: "SHALLOWNEEDLE", prefilter: true, hits: true },
  // Past the long-line guard: Postgres keeps the record, the regex never sees it.
  { pattern: "DEEPNEEDLE", prefilter: true, hits: false },
  // In the payload but not in a scanned field: kept by Postgres, no match.
  { pattern: "GHOSTNEEDLE", prefilter: true, hits: false },
  { pattern: "ATTACHNEEDLE", prefilter: true, hits: false },
  { pattern: "😀", prefilter: true, hits: true },
  { pattern: "kelvin", flags: "i", prefilter: true, hits: true },
  // Non-unicode /i does not fold ſ with s — and neither does Postgres.
  { pattern: "stop", flags: "i", prefilter: true, hits: false },
  { pattern: "FILLERRARE", prefilter: true, hits: true },
  { pattern: "fillerrare|quarterly", flags: "i", prefilter: true, hits: true },
  { pattern: "nonexistentzzz", prefilter: true, hits: false },
  // Rule 1: regex syntax — no prefilter.
  { pattern: "^second", prefilter: false, hits: true },
  { pattern: "(alpha|beta)", prefilter: false, hits: true },
  { pattern: "\\\\ path", prefilter: false, hits: true },
  { pattern: "e\\+21", prefilter: false, hits: true },
  { pattern: "0.1", prefilter: false, hits: true },
  { pattern: "1.5e", prefilter: false, hits: true },
  // Rule 3: escaping changes the text — no prefilter.
  { pattern: '"hi"', prefilter: false, hits: true },
  { pattern: "tab\there", prefilter: false, hits: true },
  { pattern: "col1\tcol2", prefilter: false, hits: true },
  { pattern: "\uD83D", prefilter: false, hits: true },
  // Rule 4: JSON spacing — no prefilter.
  { pattern: ":1", prefilter: false, hits: true },
  { pattern: "1,2", prefilter: false, hits: true },
  { pattern: "C:", prefilter: false, hits: true },
  // Rules 4–5: array joins — no prefilter.
  { pattern: "alpha, beta", prefilter: false, hits: true },
  { pattern: "x, foo", prefilter: false, hits: true },
  { pattern: " foo", prefilter: false, hits: true },
  // Rule 6: number renderings — no prefilter.
  { pattern: "21", prefilter: false, hits: true },
  { pattern: "7", prefilter: false, hits: true },
  { pattern: "1e", prefilter: false, hits: true },
  { pattern: "e-7", prefilter: false, hits: true },
  { pattern: "7000", prefilter: false, hits: true },
  { pattern: "-7", prefilter: false, hits: true },
  { pattern: "2024", prefilter: false, hits: true },
  // Rule 7: `[object Object]` — no prefilter.
  { pattern: "object", prefilter: false, hits: true },
  { pattern: "ject O", prefilter: false, hits: true },
  { pattern: "OBJECT", flags: "i", prefilter: false, hits: true },
  // Rule 8: /i folds these beyond ASCII — no prefilter.
  { pattern: "café", flags: "i", prefilter: false, hits: true },
  { pattern: "ａｂｃ", flags: "i", prefilter: false, hits: true },
  // ß folds with nothing under non-unicode /i, so this one keeps the prefilter.
  { pattern: "STRASSE|straße", flags: "i", prefilter: true, hits: true },
];

describe("grep — records prefilter answers exactly like a full scan", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseIds: string[] = [];

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-prefilter-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-prefilter-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    process.env.BUSABASE_GREP_TIMEOUT_MS = "120000";
    client = createRouterClient(busabaseRouter);

    const tricky = await client.bases.create({
      slug: "grep-prefilter-tricky",
      name: "Tricky",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "notes", name: "Notes", type: "longtext" },
        { slug: "amount", name: "Amount", type: "number" },
        { slug: "done", name: "Done", type: "checkbox" },
        { slug: "tags", name: "Tags", type: "multiselect" },
        { slug: "meta", name: "Meta", type: "json" },
        { slug: "extra", name: "Extra", type: "text" },
        { slug: "when", name: "When", type: "date" },
        { slug: "files", name: "Files", type: "attachment" },
      ],
      autoMerge: true,
    });
    const filler = await client.bases.create({
      slug: "grep-prefilter-filler",
      name: "Filler",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "body", name: "Body", type: "longtext" },
      ],
      autoMerge: true,
    });
    if ("status" in tricky || "status" in filler) throw new Error("Expected materialized BaseVOs");
    baseIds = [tricky.id, filler.id];

    const db = await getDb();
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    // Filler i is updated at minute i; tricky records sit between fillers, so
    // the scan reaches them spread over both prefiltered batches.
    const at = (minute: number) => new Date(createdAt.getTime() + minute * 60_000);
    for (let start = 0; start < FILLER_RECORDS; start += INSERT_CHUNK) {
      const ids = Array.from({ length: INSERT_CHUNK }, (_, i) => start + i);
      await db.insert(busabaseCommits).values(
        ids.map((i) => ({
          id: `cmt_prefilter_filler_${i}`,
          baseId: filler.id,
          payload: {
            title: `filler record ${i}`,
            body: `filler body line one\n${i % 997 === 0 ? "FILLERRARE " : ""}filler body line two ${"lorem ipsum ".repeat(20)}`,
          },
          author: "test",
          createdAt,
        })),
      );
      await db.insert(busabaseRecords).values(
        ids.map((i) => ({
          id: `rec_prefilter_filler_${i}`,
          baseId: filler.id,
          headCommitId: `cmt_prefilter_filler_${i}`,
          createdBy: "test",
          createdAt,
          updatedAt: at(i),
        })),
      );
    }
    const trickyNames = Object.keys(TRICKY_PAYLOADS);
    for (const [index, name] of trickyNames.entries()) {
      await db.insert(busabaseCommits).values({
        id: `cmt_prefilter_${name}`,
        baseId: tricky.id,
        payload: sql`${TRICKY_PAYLOADS[name]}::jsonb`,
        author: "test",
        createdAt,
      });
      await db.insert(busabaseRecords).values({
        id: `rec_prefilter_${name}`,
        baseId: tricky.id,
        headCommitId: `cmt_prefilter_${name}`,
        createdBy: "test",
        createdAt,
        updatedAt: at(Math.round(((index + 0.5) * FILLER_RECORDS) / trickyNames.length)),
      });
    }
  }, 120_000);

  afterEach(() => {
    delete process.env.BUSABASE_GREP_RECORDS_PREFILTER;
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

  const grepBothWays = async (input: GrepInput) => {
    process.env.BUSABASE_GREP_RECORDS_PREFILTER = "off";
    const full = await client.grep(input);
    delete process.env.BUSABASE_GREP_RECORDS_PREFILTER;
    const prefiltered = await client.grep(input);
    return { full, prefiltered };
  };

  it("derives a prefilter exactly for the cases marked prefiltered", () => {
    for (const { pattern, flags = "", prefilter } of CASES) {
      const derived = deriveRecordPrefilter(pattern, compileGrepPattern(pattern, flags));
      expect(derived !== null, `${JSON.stringify(pattern)} /${flags}`).toBe(prefilter);
    }
  });

  it.each(CASES.map((testCase) => ({ flags: "", ...testCase })))(
    "answers $pattern with flags $flags the same with and without the prefilter",
    async ({ pattern, flags, hits }) => {
      for (const contextLines of [0, 2]) {
        const { full, prefiltered } = await grepBothWays({
          pattern,
          flags,
          sources: ["records"],
          scope: { records: { baseIds } },
          maxMatches: 1_000,
          contextLines,
        });
        expect(full.matches.length > 0, `corpus has a match for ${JSON.stringify(pattern)}`).toBe(
          hits,
        );
        expect(prefiltered).toEqual(full);
        expect(full.coverage.records).toEqual({
          scanned: FILLER_RECORDS + Object.keys(TRICKY_PAYLOADS).length,
          errored: [],
          notReached: 0,
        });
      }
    },
  );

  it("stops at the same match when maxMatches cuts the scan short", async () => {
    for (const pattern of ["filler", "FILLERRARE", "line", "fillerrare|quarterly"]) {
      for (const maxMatches of [1, 3, 50]) {
        const { full, prefiltered } = await grepBothWays({
          pattern,
          flags: "i",
          sources: ["records"],
          scope: { records: { baseIds } },
          maxMatches,
          contextLines: 1,
        });
        expect(prefiltered.matches, `${pattern} max ${maxMatches}`).toEqual(full.matches);
        expect(prefiltered.truncated).toBe(full.truncated);
        const total = (coverage: typeof full.coverage.records) =>
          coverage.scanned + coverage.notReached + coverage.errored.length;
        expect(total(prefiltered.coverage.records)).toBe(total(full.coverage.records));
        // A record Postgres ruled out was examined: never fewer scanned than a full scan.
        expect(prefiltered.coverage.records.scanned).toBeGreaterThanOrEqual(
          full.coverage.records.scanned,
        );
      }
    }
  });
});
