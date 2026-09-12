import { createRouterClient } from "@orpc/server";
import { isNotNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { busabaseNodes } from "../src/db/schema";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

/**
 * The BACKFILL half of migration 0026 (and busabase-cloud's 0035), which nothing
 * else exercises.
 *
 * Both migrations run against fresh databases in CI and in every local check, so
 * their `UPDATE` matches zero rows every time: the SQL is proven to parse and
 * proven to do nothing. The half that matters to a real upgrade — thousands of
 * existing nodes that must come back with their original authors — had no
 * coverage at all until this test.
 *
 * The statement below mirrors the migration's. Only comment punctuation differs
 * (the migration quotes identifiers in backticks, which a JS template literal
 * cannot hold) — the executable SQL is the same. If you change one, change both.
 */
const BACKFILL_SQL = `
UPDATE "busabase_nodes" AS n
SET "created_by" = src."author"
FROM (
  -- The link runs through OPERATIONS, not through the commit's own node_id.
  -- A node_create commit is written before the node exists, so
  -- busabase_commits.node_id is NULL on exactly the rows this backfill needs;
  -- the id is stamped onto busabase_operations.node_id at merge time, and the
  -- author lives on the commit that operation points at.
  SELECT DISTINCT ON (o."node_id") o."node_id" AS node_id, c."author" AS author
  FROM "busabase_operations" AS o
  JOIN "busabase_commits" AS c ON c."id" = o."head_commit_id"
  WHERE o."node_id" IS NOT NULL AND c."operation" = 'node_create'
  ORDER BY o."node_id", c."created_at" ASC
) AS src
WHERE n."id" = src.node_id AND n."created_by" IS NULL;`;

describe("migration 0026 backfills node authors from commit history", () => {
  it("restores the original author of every node created through a change request", async () => {
    const { db } = await seedScenario("created-by-backfill");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "seed nodes for the backfill",
      operations: [
        { kind: "create", ref: "f", nodeType: "folder", slug: "bf-folder", name: "Folder" },
        { kind: "create", parentNodeRef: "f", nodeType: "doc", slug: "bf-doc", name: "Doc" },
        { kind: "create", nodeType: "doc", slug: "bf-doc-2", name: "Doc 2" },
      ],
    });

    const authored = await db
      .select({ id: busabaseNodes.id, createdBy: busabaseNodes.createdBy })
      .from(busabaseNodes)
      .where(isNotNull(busabaseNodes.createdBy));
    expect(authored.length).toBeGreaterThanOrEqual(3);
    const expected = new Map(authored.map((row) => [row.id, row.createdBy]));

    // Put the database back into its pre-migration shape: the column exists but
    // nothing has ever written to it.
    await db.execute(sql.raw(`UPDATE "busabase_nodes" SET "created_by" = NULL`));
    const wiped = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(isNotNull(busabaseNodes.createdBy));
    expect(wiped.length).toBe(0);

    await db.execute(sql.raw(BACKFILL_SQL));

    const restored = await db
      .select({ id: busabaseNodes.id, createdBy: busabaseNodes.createdBy })
      .from(busabaseNodes)
      .where(isNotNull(busabaseNodes.createdBy));

    // Same nodes, same authors — not merely "some rows got filled".
    expect(restored.length).toBe(expected.size);
    for (const row of restored) {
      expect(row.createdBy, `node ${row.id} came back with the wrong author`).toBe(
        expected.get(row.id),
      );
    }
  });

  it("leaves a node with no node_create commit alone rather than guessing", async () => {
    const { db } = await seedScenario("created-by-backfill-orphan");
    const raw: RawClient = createRouterClient(busabaseRouter);
    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "one real node",
      operations: [{ kind: "create", nodeType: "doc", slug: "bf-real", name: "Real" }],
    });

    // The space root is created by seeding, not by a `node_create` commit, so it
    // is exactly the "this row cannot tell" case the column is nullable for.
    await db.execute(sql.raw(`UPDATE "busabase_nodes" SET "created_by" = NULL`));
    await db.execute(sql.raw(BACKFILL_SQL));

    const rows = await db
      .select({ id: busabaseNodes.id, createdBy: busabaseNodes.createdBy })
      .from(busabaseNodes);
    const withoutAuthor = rows.filter((row) => row.createdBy === null);
    // At least the root stays NULL — attributing it to whoever happened to run
    // the seed would be inventing an author, which the filter must never show.
    expect(withoutAuthor.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.createdBy !== null)).toBe(true);
  });
});
