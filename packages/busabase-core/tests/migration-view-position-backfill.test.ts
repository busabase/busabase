import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The migration that gave views a `position` also backfills every existing
 * Base with a real "Grid view" at position 0 (the dashboard's unsaved "All"
 * tab is gone) and numbers existing views 1..n by creation time.
 *
 * Exercised the way an upgrade meets it: a database migrated up to the
 * previous migration, holding legacy rows, then brought up to date. The same
 * statements ship in busabase-cloud's own migration directory.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../apps/busabase/src/db/migrations");
const BACKFILL_TAG = "0034_messy_scourge";

type ViewRow = {
  id: string;
  base_id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  position: number;
  archived_at: Date | null;
  created_by: string;
  config: Record<string, unknown>;
};

describe(`migration ${BACKFILL_TAG}: view positions + Grid view backfill`, () => {
  let workDir = "";
  let client: PGlite;
  let views: ViewRow[] = [];

  const archivedAt = new Date("2026-05-01T10:00:00Z");
  const nodeDeletedAt = new Date("2026-05-02T10:00:00Z");

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), "busabase-view-backfill-"));
    // The migrations folder as it was before this change: same files, journal
    // cut just before the backfill.
    const previousDir = path.join(workDir, "previous");
    await cp(MIGRATIONS_DIR, previousDir, { recursive: true });
    const journalPath = path.join(previousDir, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const cut = journal.entries.findIndex((entry) => entry.tag === BACKFILL_TAG);
    expect(cut).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, cut);
    await writeFile(journalPath, JSON.stringify(journal));

    client = new PGlite(path.join(workDir, "db"), { extensions: { pg_trgm } });
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: previousDir });

    // Legacy rows, written with the pre-migration columns (no `position`).
    await client.exec(`
      INSERT INTO busabase_nodes (id, space_id, parent_id, type, slug, name) VALUES
        ('nod_legacy_root', 'spc_legacy', NULL, 'folder', 'root', 'Root'),
        ('nod_a', 'spc_legacy', 'nod_legacy_root', 'base', 'a', 'A'),
        ('nod_b', 'spc_legacy', 'nod_legacy_root', 'base', 'b', 'B'),
        ('nod_c', 'spc_legacy', 'nod_legacy_root', 'base', 'c', 'C'),
        ('nod_d', 'spc_legacy', 'nod_legacy_root', 'base', 'd', 'D'),
        ('nod_e', 'spc_legacy', 'nod_legacy_root', 'base', 'e', 'E');
      UPDATE busabase_nodes SET created_by = 'usr_owner' WHERE id = 'nod_a';
      INSERT INTO busabase_bases (id, space_id, node_id, slug, name, archived_at) VALUES
        ('bse_a', 'spc_legacy', 'nod_a', 'a', 'A', NULL),
        ('bse_b', 'spc_legacy', 'nod_b', 'b', 'B', NULL),
        ('bse_c', 'spc_legacy', 'nod_c', 'c', 'C', '${archivedAt.toISOString()}'),
        ('bse_d', 'spc_legacy', 'nod_d', 'd', 'D', '${nodeDeletedAt.toISOString()}'),
        ('bse_e', 'spc_legacy', 'nod_e', 'e', 'E', NULL);
      INSERT INTO busabase_views
        (id, space_id, base_id, slug, name, type, config, status, created_by, archived_at, created_at)
      VALUES
        -- A: two views, created out of id order, plus one deleted earlier.
        ('viw_a2', 'spc_legacy', 'bse_a', 'later', 'Later', 'kanban', '{}', 'active', 'u', NULL, '2026-01-03'),
        ('viw_a1', 'spc_legacy', 'bse_a', 'first', 'First', 'table', '{}', 'active', 'u', NULL, '2026-01-02'),
        ('viw_a0', 'spc_legacy', 'bse_a', 'gone', 'Gone', 'table', '{}', 'archived', 'u', '2026-01-04', '2026-01-01'),
        -- B: already has a view using the Grid view's slug.
        ('viw_b1', 'spc_legacy', 'bse_b', 'grid-view', 'Mine', 'table', '{}', 'active', 'u', NULL, '2026-01-01'),
        -- C: Base archived through bases.archive, which archived its view with it.
        ('viw_c1', 'spc_legacy', 'bse_c', 'open', 'Open', 'table', '{}', 'archived', 'u', '${archivedAt.toISOString()}', '2026-01-01'),
        -- D: Base deleted as a node, which leaves its views active.
        ('viw_d1', 'spc_legacy', 'bse_d', 'open', 'Open', 'table', '{}', 'active', 'u', NULL, '2026-01-01');
    `);

    // Bring it up to date: applies only the backfill migration.
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    views = (
      await client.query<ViewRow>(
        `SELECT id, base_id, slug, name, type, status, position, archived_at, created_by, config
         FROM busabase_views ORDER BY base_id, position, created_at`,
      )
    ).rows;
  });

  afterAll(async () => {
    await client?.close();
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  const viewsOf = (baseId: string) => views.filter((view) => view.base_id === baseId);

  it("puts a Grid view first and numbers existing views 1..n by creation time", () => {
    expect(viewsOf("bse_a").map((view) => [view.id, view.position])).toEqual([
      ["viw_grid_bse_a", 0],
      ["viw_a0", 1],
      ["viw_a1", 2],
      ["viw_a2", 3],
    ]);
    const [grid] = viewsOf("bse_a");
    expect(grid).toMatchObject({
      slug: "grid-view",
      name: "Grid view",
      type: "table",
      status: "active",
      archived_at: null,
      // Attributed to whoever created the Base.
      created_by: "usr_owner",
    });
    // Exactly what a brand-new unfiltered table view stores: every field, no rules.
    expect(grid.config).toEqual({
      filters: [],
      sorts: [],
      stackByFieldSlug: null,
      dateFieldSlug: null,
      startFieldSlug: null,
      endFieldSlug: null,
    });
  });

  it("gives every Base exactly one Grid view, falling back to the local actor", () => {
    for (const baseId of ["bse_a", "bse_b", "bse_c", "bse_d", "bse_e"]) {
      expect(viewsOf(baseId).filter((view) => view.name === "Grid view")).toHaveLength(1);
    }
    expect(viewsOf("bse_e")).toMatchObject([
      { id: "viw_grid_bse_e", slug: "grid-view", position: 0, status: "active" },
    ]);
    expect(viewsOf("bse_e")[0].created_by).toBe("local-admin");
  });

  it("does not take a slug the Base already uses", () => {
    const [grid, mine] = viewsOf("bse_b");
    expect(mine).toMatchObject({ id: "viw_b1", slug: "grid-view", position: 1 });
    expect(grid.id).toBe("viw_grid_bse_b");
    expect(grid.slug).toMatch(/^grid-view-[0-9a-f]{6}$/);
  });

  it("archives the Grid view with a Base whose views were archived with it", async () => {
    // So bases.restore — which re-activates views carrying the Base's archive
    // timestamp — brings the Grid view back together with the rest.
    const [grid] = viewsOf("bse_c");
    expect(grid).toMatchObject({ id: "viw_grid_bse_c", status: "archived", position: 0 });
    const { rows } = await client.query<{ matches: boolean }>(
      `SELECT v.archived_at = b.archived_at AS matches
       FROM busabase_views v JOIN busabase_bases b ON b.id = v.base_id
       WHERE v.id = 'viw_grid_bse_c'`,
    );
    expect(rows).toEqual([{ matches: true }]);
  });

  it("keeps the Grid view active for a Base whose node delete left its views active", () => {
    const [grid] = viewsOf("bse_d");
    expect(grid).toMatchObject({ id: "viw_grid_bse_d", status: "active", archived_at: null });
  });
});
