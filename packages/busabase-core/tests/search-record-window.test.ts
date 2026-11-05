import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID } from "../src/context";
import { getDb } from "../src/db";
import { busabaseCommits, busabaseFieldValues, busabaseRecords } from "../src/db/schema";
import { findRecordMatches, RECORD_SEARCH_WINDOW_ROWS } from "../src/logic/search-record-query";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

/**
 * Record search ranks a bounded window of matches.
 *
 * Ranking every match ran `to_tsvector` and `ts_rank` over each one before
 * LIMIT. In a space with 70k records a common word matched over 100k field
 * values, so every such search timed out (408) and returned nothing. Search now
 * ranks the newest matches (oldest, for ascending sorts) and says when there
 * were more than it ranked.
 */

const raw = () => createRouterClient(busabaseRouter);
const COMMON = RECORD_SEARCH_WINDOW_ROWS + 200;
const START = Date.UTC(2026, 0, 1);

/** The id shape `kernel.id` writes: prefix, base36 write time, random tail. */
const timedId = (prefix: string, at: number, index: number) =>
  `${prefix}${at.toString(36)}${index.toString(36).padStart(7, "0")}`;

type Db = Awaited<ReturnType<typeof seedScenario>>["db"];

interface Note {
  at: number;
  recordId: string;
  commitId: string;
  fieldValueId: string;
  text: string;
}

/**
 * Rows go straight into the tables: 1,200 change requests through the API
 * would take minutes, and search reads only records and field values.
 */
const insertNotes = async (db: Db, baseId: string, notes: Note[]) => {
  for (let start = 0; start < notes.length; start += 400) {
    const chunk = notes.slice(start, start + 400);
    await db.insert(busabaseCommits).values(
      chunk.map((note) => ({
        id: note.commitId,
        baseId,
        payload: { title: note.text },
        author: "test",
        createdAt: new Date(note.at),
      })),
    );
    await db.insert(busabaseRecords).values(
      chunk.map((note) => ({
        id: note.recordId,
        baseId,
        headCommitId: note.commitId,
        createdBy: "test",
        createdAt: new Date(note.at),
        updatedAt: new Date(note.at),
      })),
    );
    await db.insert(busabaseFieldValues).values(
      chunk.map((note) => ({
        id: note.fieldValueId,
        baseId,
        recordId: note.recordId,
        commitId: note.commitId,
        fieldSlug: "title",
        fieldType: "text" as const,
        valueText: note.text,
        createdAt: new Date(note.at),
        updatedAt: new Date(note.at),
      })),
    );
  }
};

const recordIds = (result: Awaited<ReturnType<ReturnType<typeof raw>["search"]>>) =>
  result.results.filter((row) => row.kind === "record").map((row) => row.id);

describe("record search window", () => {
  it("ranks the newest matches, reports the rest, and stays complete below the window", async () => {
    const { client, db } = await seedScenario("record-search-window");
    const base = await client.bases.create({ slug: "notes", name: "Notes" });

    const rows = Array.from({ length: COMMON }, (_, index) => {
      const at = START + index * 60_000;
      const recordId = timedId("rec", at, index);
      const commitId = timedId("cmt", at, index);
      // Every 400th note also carries the rare word, oldest one first.
      const text = `windowword note ${index}${index % 400 === 0 ? " rarewindowword" : ""}`;
      return { at, recordId, commitId, text, index, fieldValueId: timedId("fvl", at, index) };
    });
    await insertNotes(db, base.id, rows);
    const newest = rows.map((row) => row.recordId).reverse();

    const common = await raw().search({ query: "windowword", sources: ["records"], limit: 5 });
    expect(common.contentTruncated).toBe(true);
    expect(common.hasMore).toBe(true);
    expect(recordIds(common)).toEqual(newest.slice(0, 5));

    // Ascending sorts rank the oldest matches instead of the newest.
    const oldest = await raw().search({
      query: "windowword",
      sources: ["records"],
      sort: "created_asc",
      limit: 3,
    });
    expect(oldest.contentTruncated).toBe(true);
    expect(recordIds(oldest)).toEqual(rows.slice(0, 3).map((row) => row.recordId));

    // Below the window every match is ranked, including the oldest one.
    const rare = await raw().search({ query: "rarewindowword", sources: ["records"], limit: 20 });
    expect(rare.contentTruncated).toBe(false);
    expect(recordIds(rare).sort()).toEqual(
      rows
        .filter((row) => row.index % 400 === 0)
        .map((row) => row.recordId)
        .sort(),
    );

    // A scan that runs out of time answers with the newest matches it found,
    // marked incomplete, instead of failing. Short input, so no index helps.
    const dbInstance = await getDb();
    const outOfTime = await findRecordMatches(dbInstance, {
      query: "e ",
      spaceId: LOCAL_SPACE_ID,
      eligibility: undefined,
      rows: 2_000,
      oldestFirst: false,
      scanUntil: 0,
      indexTimeoutMs: 1_000,
      chunkRows: 100,
    });
    expect(outOfTime.truncated).toBe(true);
    expect(outOfTime.ids.length).toBeGreaterThan(0);
    expect(outOfTime.ids.length).toBeLessThan(COMMON);
    const fieldValueIds = rows.map((row) => timedId("fvl", row.at, row.index)).reverse();
    expect(outOfTime.ids).toEqual(fieldValueIds.slice(0, outOfTime.ids.length));
    const complete = await findRecordMatches(dbInstance, {
      query: "e ",
      spaceId: LOCAL_SPACE_ID,
      eligibility: undefined,
      rows: 2_000,
      oldestFirst: false,
      scanUntil: Number.POSITIVE_INFINITY,
      indexTimeoutMs: 1_000,
      chunkRows: 100,
    });
    expect(complete.truncated).toBe(false);
    expect(complete.ids).toEqual(fieldValueIds);
  }, 120_000);

  it("searches field values whose ids predate today's id shape", async () => {
    const { client, db } = await seedScenario("record-search-legacy-ids");
    const base = await client.bases.create({ slug: "legacy", name: "Legacy" });
    const current = Array.from({ length: COMMON }, (_, index) => {
      const at = START + index * 60_000;
      return {
        at,
        recordId: timedId("rec", at, index),
        commitId: timedId("cmt", at, index),
        fieldValueId: timedId("fvl", at, index),
        text: `windowword note ${index}`,
      };
    });
    await insertNotes(db, base.id, current);
    // Before 2026-06-22 `kernel.id` wrote `qfv_<time>_<random>`; an import can
    // carry ids no generator here writes at all. Both sort outside every
    // space's current-id range, and both are older than every current note.
    const before = Date.UTC(2025, 5, 1);
    await insertNotes(db, base.id, [
      {
        at: before,
        recordId: "rec_legacy_kernel",
        commitId: "cmt_legacy_kernel",
        fieldValueId: `qfv_${before.toString(36)}_abc1234`,
        text: "windowword legacyneedle kernel 鲲鹏",
      },
      {
        at: before + 60_000,
        recordId: "rec_legacy_import",
        commitId: "cmt_legacy_import",
        fieldValueId: "abc-imported-value",
        text: "windowword legacyneedle import 鲲鹏",
      },
    ]);
    for (const mode of ["quick", "full"] as const) {
      // A rare word only the legacy rows hold: found, and complete.
      const rare = await raw().search({
        query: "legacyneedle",
        mode,
        sources: ["records"],
        limit: 20,
      });
      expect(recordIds(rare).sort()).toEqual(["rec_legacy_import", "rec_legacy_kernel"]);
      expect(rare.contentTruncated).toBe(false);

      // A common word fills the window; the legacy rows are its oldest
      // matches, so the oldest-first window leads with them.
      const oldest = await raw().search({
        query: "windowword",
        mode,
        sources: ["records"],
        sort: "created_asc",
        limit: 3,
      });
      expect(oldest.contentTruncated).toBe(true);
      expect(recordIds(oldest)).toEqual([
        "rec_legacy_kernel",
        "rec_legacy_import",
        current[0]?.recordId,
      ]);
    }

    // The same, through each path a large space takes: small scan steps so
    // the first step does not cover the space.
    const legacyIds = [`qfv_${before.toString(36)}_abc1234`, "abc-imported-value"];
    const find = async (query: string) =>
      findRecordMatches(await getDb(), {
        query,
        spaceId: LOCAL_SPACE_ID,
        eligibility: undefined,
        rows: 50,
        oldestFirst: false,
        scanUntil: Number.POSITIVE_INFINITY,
        indexTimeoutMs: 5_000,
        chunkRows: 100,
      });
    // A word the trigram index answers.
    expect((await find("legacyneedle")).ids.sort()).toEqual([...legacyIds].sort());
    // An input with no trigrams, scanned step by step to the end.
    expect((await find("鲲鹏")).ids.sort()).toEqual([...legacyIds].sort());
  }, 120_000);

  it("merges full-text and substring matches for a multi-word query", async () => {
    const { client } = await seedScenario("record-search-multi-word");
    const base = await client.bases.create({ slug: "phrases", name: "Phrases" });
    const titles = ["alpha gamma beta", "xalpha betay", "alpha only"];
    for (const title of titles) {
      await client.records.createChangeRequest({
        baseId: base.id,
        fields: { title },
        mergeImmediately: true,
      });
    }
    const result = await raw().search({ query: "alpha beta", sources: ["records"], limit: 20 });
    // Both words, apart: full text. Inside longer words: substring only.
    expect(result.results.map((row) => row.title).sort()).toEqual([
      "alpha gamma beta",
      "xalpha betay",
    ]);
    expect(result.contentTruncated).toBe(false);
  });
});
