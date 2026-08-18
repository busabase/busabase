/**
 * Red/green proof that moving the node ACL's explicit input from
 * `metadata.visibility` to the `explicit_visibility` column PRESERVES the
 * visibility every existing node already declared.
 *
 * `drizzle-kit generate` emits `ADD COLUMN` and nothing else. Shipping only
 * that leaves the column NULL everywhere, and `explicitVisibilityOf` — which
 * now reads the column — would report "declares nothing" for every node that
 * ever set itself private. The next space-wide `recomputeSpaceNodeAcl`, which
 * any unrelated visibility change anywhere in the space triggers, would then
 * recompute those nodes as inheriting-and-visible.
 *
 * That failure is silent, delayed, and points the wrong way: private content
 * becomes readable. It is the same shape as the bypass PR #5976 fixed, with the
 * direction reversed — which is why reasoning about the SQL is not enough and
 * this replays it against a real Postgres (PGlite):
 *
 *   1. apply every migration UP TO BUT NOT INCLUDING this one   (old schema)
 *   2. INSERT nodes declaring visibility the old way, in `metadata`
 *   3. apply the migration
 *   4. assert every declaration landed in `explicit_visibility`, that the
 *      now-migrated key is gone from `metadata`, and that values the migration
 *      cannot interpret were left alone rather than destroyed
 *
 * RED CONTROL: step 4 also runs against the DDL-only variant (`ADD COLUMN`
 * with no backfill) on a second database, proving the assertion actually fails
 * when the data does not move — i.e. that step 4 is not vacuous.
 *
 * Run: pnpm --filter busabase exec tsx scripts/verify-explicit-visibility-migration.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url ?? `file://${__filename}`)),
  "../src/db/migrations",
);
const DDL_ONLY_SQL = 'ALTER TABLE "busabase_nodes" ADD COLUMN "explicit_visibility" text;';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as {
  entries: { tag: string }[];
};

const migrationTag = journal.entries.find((entry) =>
  readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8").includes(
    'ADD COLUMN "explicit_visibility"',
  ),
)?.tag;
if (!migrationTag) {
  throw new Error("No migration adds busabase_nodes.explicit_visibility");
}
const priorTags = journal.entries
  .map((e) => e.tag)
  .slice(
    0,
    journal.entries.findIndex((e) => e.tag === migrationTag),
  );

/**
 * One row per case the backfill has to get right. `expected` is what
 * `explicit_visibility` must hold afterwards; `keepsMetadataKey` says whether
 * the original `metadata.visibility` should survive (only for values the
 * migration deliberately refuses to interpret).
 */
const CASES = [
  { id: "nod_private", metadata: { visibility: "private" }, expected: "private" },
  { id: "nod_workspace", metadata: { visibility: "workspace" }, expected: "workspace" },
  { id: "nod_public", metadata: { visibility: "public" }, expected: "public" },
  // Declares nothing — must stay NULL, i.e. "inherit", not silently become a value.
  { id: "nod_silent", metadata: {}, expected: null },
  // Other free-form keys alongside it must survive untouched: the bag is still
  // the bag, and this migration only claims the one key.
  {
    id: "nod_with_extras",
    metadata: { visibility: "private", busabaseCms: { baseId: "bas_x" }, mine: 1 },
    expected: "private",
  },
  // A value the migration cannot interpret is LEFT in metadata rather than
  // dropped — losing it would be worse than leaving it somewhere stale.
  {
    id: "nod_unknown",
    metadata: { visibility: "top-secret" },
    expected: null,
    keepsMetadataKey: true,
  },
] as const;

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
    "select column_name from information_schema.columns where table_name = 'busabase_nodes'",
  );
  const names = columns.rows.map((r) => r.column_name);
  if (names.includes("explicit_visibility")) {
    throw new Error("pre-migration schema already has explicit_visibility");
  }

  for (const testCase of CASES) {
    await db.query(
      `insert into busabase_nodes (id, space_id, parent_id, type, slug, name, description, metadata, position, created_at, updated_at)
       values ($1, 'spc_legacy', null, 'folder', $2, $3, '', $4, 0, now(), now())`,
      [testCase.id, testCase.id.replace(/_/g, "-"), testCase.id, JSON.stringify(testCase.metadata)],
    );
  }
};

const assertBackfilled = async (db: PGlite, label: string) => {
  for (const testCase of CASES) {
    const result = await db.query<{ explicit_visibility: string | null; metadata: unknown }>(
      "select explicit_visibility, metadata from busabase_nodes where id = $1",
      [testCase.id],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`${label}: ${testCase.id} vanished`);

    if (row.explicit_visibility !== testCase.expected) {
      throw new Error(
        `${label}: ${testCase.id} explicit_visibility is ${JSON.stringify(
          row.explicit_visibility,
        )}, expected ${JSON.stringify(testCase.expected)}`,
      );
    }

    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const keepsKey = "keepsMetadataKey" in testCase && testCase.keepsMetadataKey;
    const hasKey = Object.hasOwn(metadata, "visibility");
    if (keepsKey && !hasKey) {
      throw new Error(`${label}: ${testCase.id} lost an uninterpretable metadata.visibility`);
    }
    if (!keepsKey && testCase.expected !== null && hasKey) {
      throw new Error(`${label}: ${testCase.id} still carries a migrated metadata.visibility`);
    }
  }

  // The bag keeps everything this migration did not claim.
  const extras = await db.query<{ metadata: Record<string, unknown> }>(
    "select metadata from busabase_nodes where id = 'nod_with_extras'",
  );
  const bag = extras.rows[0]?.metadata ?? {};
  if (JSON.stringify(bag.busabaseCms) !== JSON.stringify({ baseId: "bas_x" }) || bag.mine !== 1) {
    throw new Error(`${label}: unrelated metadata keys were disturbed: ${JSON.stringify(bag)}`);
  }
};

const run = async () => {
  console.log(`migration under test: ${migrationTag}.sql`);
  console.log(`replaying ${priorTags.length} prior migrations on a fresh PGlite database\n`);

  // The schema's trigram indexes need the extension present before replay, the
  // same way `verify-commit-payload-rename-migration.ts` loads it.
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  const freshDb = () => new PGlite({ extensions: { pg_trgm } });

  // ── GREEN: the migration we actually generated ─────────────────────────────
  const green = freshDb();
  await seedOldSchema(green);
  await applyFile(green, migrationTag);
  await assertBackfilled(green, "GREEN");
  console.log("✅ GREEN: every declared visibility survived the move to the column.");
  await green.close();

  // ── RED CONTROL: DDL only, no backfill ─────────────────────────────────────
  const red = freshDb();
  await seedOldSchema(red);
  await red.exec(DDL_ONLY_SQL);
  let redFailed = false;
  try {
    await assertBackfilled(red, "RED");
  } catch (error) {
    redFailed = true;
    console.log(`✅ RED control failed as required: ${(error as Error).message}`);
  }
  await red.close();
  if (!redFailed) {
    throw new Error("RED control PASSED — the assertions are vacuous and prove nothing");
  }

  console.log("\nAll visibility migration data-safety checks passed.");
};

run().catch((error) => {
  console.error(`\n❌ ${(error as Error).message}`);
  process.exit(1);
});
