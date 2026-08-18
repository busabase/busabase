/**
 * Red/green proof that the `busabase_commits.fields` → `payload` rename
 * PRESERVES existing commit payloads instead of dropping them.
 *
 * A drop-old-column + add-new-column migration would type-check and deploy
 * cleanly while silently erasing every Doc body, Base record value and file-tree
 * edit ever committed. Reasoning about the generated SQL is not enough, so this
 * replays it against a real Postgres (PGlite):
 *
 *   1. apply every migration UP TO BUT NOT INCLUDING the rename  (old schema)
 *   2. INSERT a commit carrying a non-trivial payload into `fields`
 *   3. apply the rename migration
 *   4. assert the row still exists and `payload` is byte-for-byte the old value
 *
 * RED CONTROL: step 4 is also run against a deliberately destructive
 * drop+add variant of the same migration, on a second database, to prove the
 * assertion actually fails when data is lost (i.e. that step 4 is not vacuous).
 *
 * Run: pnpm --filter busabase exec tsx scripts/verify-commit-payload-rename-migration.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url ?? `file://${__filename}`)),
  "../src/db/migrations",
);
const DESTRUCTIVE_SQL = [
  'ALTER TABLE "busabase_commits" DROP COLUMN "fields";',
  'ALTER TABLE "busabase_commits" ADD COLUMN "payload" jsonb DEFAULT \'{}\'::jsonb NOT NULL;',
].join("\n");

const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as {
  entries: { tag: string }[];
};

const renameTag = journal.entries.find((entry) => {
  const file = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
  return readFileSync(file, "utf8").includes('RENAME COLUMN "fields" TO "payload"');
})?.tag;

if (!renameTag) {
  throw new Error("No migration renames busabase_commits.fields → payload");
}
const priorTags = journal.entries
  .map((e) => e.tag)
  .slice(
    0,
    journal.entries.findIndex((e) => e.tag === renameTag),
  );

const HISTORIC_PAYLOAD = {
  body: "# Release notes\n\nLine with 'quotes', \"double quotes\" and a \\ backslash.\n中文正文。",
  tags: ["agents", "workflow"],
  nested: { deep: { n: 42, flag: false, nil: null } },
  emptyObject: {},
  emptyArray: [],
};

const applyFile = async (db: PGlite, tag: string) => {
  const sql = readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) await db.exec(trimmed);
  }
};

const seedOldSchema = async (db: PGlite) => {
  for (const tag of priorTags) await applyFile(db, tag);

  const columns = await db.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_name = 'busabase_commits'",
  );
  const names = columns.rows.map((r) => r.column_name);
  if (!names.includes("fields") || names.includes("payload")) {
    throw new Error(`pre-migration schema is wrong: ${names.join(", ")}`);
  }

  await db.query(
    `insert into busabase_commits (id, space_id, base_id, target_type, node_id, operation_id, parent_commit_id, fields, operation, message, author, created_at)
     values ($1, $2, null, 'node', null, null, null, $3, 'doc_update', $4, $5, now())`,
    [
      "cmt_legacy_history",
      "spc_legacy",
      JSON.stringify(HISTORIC_PAYLOAD),
      "Historic commit written before the rename",
      "legacy-author",
    ],
  );
};

/**
 * Stable stringify — Postgres `jsonb` does not preserve object key order (it
 * normalises by key length then bytes), so a plain JSON.stringify comparison
 * would report a false difference on data that is in fact fully intact.
 */
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const assertPayloadSurvived = async (db: PGlite, label: string) => {
  const res = await db.query<{ payload: unknown; message: string; operation: string }>(
    "select payload, message, operation from busabase_commits where id = $1",
    ["cmt_legacy_history"],
  );
  if (res.rows.length !== 1) throw new Error(`${label}: historic commit row disappeared`);
  const row = res.rows[0];
  const actual = stable(row.payload);
  const expected = stable(HISTORIC_PAYLOAD);
  if (actual !== expected) {
    throw new Error(`${label}: payload changed\n  expected ${expected}\n  actual   ${actual}`);
  }
  if (
    row.message !== "Historic commit written before the rename" ||
    row.operation !== "doc_update"
  ) {
    throw new Error(`${label}: sibling columns changed`);
  }
};

const main = async () => {
  console.log(`rename migration under test: ${renameTag}.sql`);
  console.log(`replaying ${priorTags.length} prior migrations on a fresh PGlite database\n`);

  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const freshDb = () => new PGlite({ extensions: { pg_trgm } });

  // ── GREEN: the migration we actually generated ────────────────────────────
  const green = freshDb();
  await seedOldSchema(green);
  const before = await green.query<{ fields: unknown }>(
    "select fields from busabase_commits where id = 'cmt_legacy_history'",
  );
  console.log(
    "BEFORE migration, fields =",
    JSON.stringify(before.rows[0]?.fields).slice(0, 90),
    "…",
  );
  await applyFile(green, renameTag);
  await assertPayloadSurvived(green, "GREEN");
  const after = await green.query<{ payload: unknown }>(
    "select payload from busabase_commits where id = 'cmt_legacy_history'",
  );
  console.log(
    "AFTER  migration, payload =",
    JSON.stringify(after.rows[0]?.payload).slice(0, 90),
    "…",
  );
  console.log("\n✅ GREEN: RENAME COLUMN preserved the historic payload byte-for-byte.");
  await green.close();

  // ── RED CONTROL: prove the assertion is not vacuous ───────────────────────
  const red = freshDb();
  await seedOldSchema(red);
  for (const statement of DESTRUCTIVE_SQL.split("\n")) await red.exec(statement);
  let redFailed = false;
  try {
    await assertPayloadSurvived(red, "RED");
  } catch (error) {
    redFailed = true;
    console.log(`\n✅ RED control failed as required: ${(error as Error).message.split("\n")[0]}`);
  }
  await red.close();
  if (!redFailed) {
    throw new Error("RED control PASSED — the survival assertion is vacuous and proves nothing");
  }

  console.log("\nAll migration data-safety checks passed.");
};

main().catch((error) => {
  console.error("\n❌", error);
  process.exit(1);
});
