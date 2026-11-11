/**
 * Legacy attachment references found by Postgres match exactly what the
 * in-process matcher finds.
 *
 * Permanent deletion looks for strings in the purged subtree that equal an
 * attachment id or contain its storage key. It used to load every attachment
 * the space owns (143,000 in one production space) and match here; now
 * Postgres answers for a little text. Both sides must give the same answer
 * for every text: keys with quotes, backslashes, braces, `NULL`, CJK, emoji,
 * a line break (which must not match across two texts), an empty key (which
 * matches every text, as before), and attachments the space does not own.
 *
 * Runs on PGlite. Set PURGE_MATCH_PG_TEST_URL to an admin URL whose user may
 * create databases to run it on a real server too (postgres-js serializes the
 * text arrays differently); a throwaway database is created and dropped.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BusabaseDatabase } from "../src/context";
import * as schema from "../src/db/schema";
import {
  type AttachmentRef,
  createAttachmentMatcher,
  findReferencedAttachments,
} from "../src/domains/assets/logic/purge-assets-logic";

const MIGRATIONS = path.resolve(__dirname, "../../../apps/busabase/src/db/migrations");
const adminUrl = process.env.PURGE_MATCH_PG_TEST_URL?.trim();
const SPACE = "space_match";

/** Attachments the space owns directly. */
const owned: AttachmentRef[] = [
  { id: "att_blob", storageKey: "attachments/blobs/abc123.pdf" },
  { id: "att_prefix", storageKey: "attachments/blobs/abc" },
  { id: "att_escape", storageKey: 'attachments/u1/general/we"ird\\,{key}.pdf' },
  { id: "att_newline", storageKey: "attachments/u1/general/two\nlines.txt" },
  { id: "att_cjk", storageKey: "attachments/u1/general/季度报告✓.pdf" },
  { id: "att_emoji", storageKey: "attachments/u1/general/😀.png" },
  { id: "att_null", storageKey: "NULL" },
  { id: "att_short", storageKey: "a.b" },
  { id: "att_like", storageKey: "files/100%_x" },
  { id: "att_empty", storageKey: "" },
];
/** Owned only through one of the space's Assets (legacy rows with no space). */
const viaAsset: AttachmentRef = { id: "att_via_asset", storageKey: "attachments/legacy/x.pdf" };
/** Another space's bytes: never a reference of this space. */
const foreign: AttachmentRef = { id: "att_foreign", storageKey: "attachments/blobs/foreign.pdf" };

const texts = [
  "see https://cdn.example.test/attachments/blobs/abc123.pdf?x=1",
  "attachments/blobs/ab",
  'he said "attachments/u1/general/we"ird\\,{key}.pdf" twice',
  "attachments/u1/general/two\nlines.txt",
  "attachments/u1/general/two",
  "lines.txt and more",
  "报告: attachments/u1/general/季度报告✓.pdf",
  "😀 attachments/u1/general/😀.png",
  "the word NULL",
  '{a,b} \\ "quoted"',
  "att_blob",
  " att_cjk",
  "att_via_asset",
  "x attachments/legacy/x.pdf",
  "att_foreign",
  "attachments/blobs/foreign.pdf",
  "",
  "aXb",
  "files/100abcx",
];

const engines: Array<{
  name: string;
  enabled: boolean;
  open: () => Promise<{ db: BusabaseDatabase; close: () => Promise<void> }>;
}> = [
  {
    name: "PGlite",
    enabled: true,
    open: async () => {
      const client = new PGlite({ extensions: { pg_trgm } });
      const db = drizzlePglite({ client, schema });
      await migratePglite(db, { migrationsFolder: MIGRATIONS });
      return { db, close: () => client.close() };
    },
  },
  {
    name: "PostgreSQL",
    enabled: Boolean(adminUrl),
    open: async () => {
      if (!adminUrl) throw new Error("PURGE_MATCH_PG_TEST_URL is not configured");
      const dbName = `busabase_purge_match_${Date.now()}`;
      const admin = postgres(adminUrl, { max: 1, prepare: false });
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
      const url = new URL(adminUrl);
      url.pathname = `/${dbName}`;
      // Production shape: postgres-js without prepared statements.
      const client = postgres(url.toString(), { max: 2, prepare: false });
      const db = drizzlePostgres(client, { schema });
      await migratePostgres(db, { migrationsFolder: MIGRATIONS });
      return {
        db,
        close: async () => {
          await client.end({ timeout: 5 });
          await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
          await admin.end({ timeout: 5 });
        },
      };
    },
  },
];

describe.each(engines)("legacy attachment references matched in $name", (engine) => {
  let db: BusabaseDatabase;
  let close: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    if (!engine.enabled) return;
    ({ db, close } = await engine.open());
    const row = (ref: AttachmentRef, spaceId: string | null) => ({
      ...ref,
      fileName: "file",
      mimeType: "application/octet-stream",
      sizeBytes: 3,
      userId: "match-owner",
      spaceId,
    });
    await db
      .insert(schema.attachments)
      .values([
        ...owned.map((ref) => row(ref, SPACE)),
        row(viaAsset, null),
        row(foreign, "space_other"),
      ]);
    await db.insert(schema.busabaseAssets).values([
      { id: "ast_via_asset", spaceId: SPACE, attachmentId: viaAsset.id, name: "x.pdf" },
      { id: "ast_foreign", spaceId: "space_other", attachmentId: foreign.id, name: "f.pdf" },
    ]);
  }, 120_000);

  afterAll(async () => {
    await close?.();
  });

  /** What the in-process matcher finds over everything the space owns. */
  const expected = (input: readonly string[]) => {
    const match = createAttachmentMatcher([...owned, viaAsset]);
    return [...new Set(input.flatMap((text) => match(text).map((ref) => ref.id)))].sort();
  };
  const found = async (input: readonly string[]) =>
    (await findReferencedAttachments(db, SPACE, input)).map((ref) => ref.id).sort();

  it.skipIf(!engine.enabled)("agrees with the in-process matcher for each text alone", async () => {
    for (const text of texts) {
      expect({ text, ids: await found([text]) }).toEqual({ text, ids: expected([text]) });
    }
  });

  it.skipIf(!engine.enabled)(
    "agrees for all texts at once, without matching across them",
    async () => {
      const ids = await found(texts);
      expect(ids).toEqual(expected(texts));
      // Spot checks against the rule itself, not just the other implementation.
      expect(ids).toEqual(
        expect.arrayContaining([
          "att_blob",
          "att_prefix",
          "att_escape",
          "att_newline",
          "att_cjk",
          "att_emoji",
          "att_null",
          "att_empty",
          "att_via_asset",
        ]),
      );
      expect(ids).not.toContain("att_foreign");
      expect(ids).not.toContain("att_short");
      expect(ids).not.toContain("att_like");
      expect(await found(["attachments/u1/general/two", "lines.txt"])).not.toContain("att_newline");
    },
  );

  it.skipIf(!engine.enabled)("finds nothing when there is no text", async () => {
    expect(await found([])).toEqual([]);
  });
});
