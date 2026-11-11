import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import * as schema from "../src/db/schema";
import { DUMP_TABLE_REGISTRY } from "../src/domains/dump/logic/table-registry";

// New persisted user data must join the backup contract, rather than silently
// disappearing because only the preexisting table registry was round-tripped.
const intentionalExclusions = {
  busabase_node_content_search: "Rebuildable node search index",
  busabase_asset_text_search: "Rebuildable extracted-text search index",
  busabase_asset_text_search_chunks: "Rebuildable extracted-text search chunks",
  busabase_storage_cleanup_jobs: "Source deletion outbox must never replay against restored data",
  busabase_vault_items: "Dedicated credential store",
  busabase_router_oauth_states: "One-time OAuth credentials",
  busabase_router_pending_enrollments: "Pending credential enrollment",
};

it("classifies every persistent kernel table as backed up or explicitly excluded", () => {
  const persisted = new Set(
    Object.values(schema)
      .filter((value) => is(value, PgTable))
      .map(getTableName),
  );
  const backedUp = new Set(Object.values(DUMP_TABLE_REGISTRY).map(getTableName));
  for (const excluded of Object.keys(intentionalExclusions))
    expect(backedUp.has(excluded), `${excluded} must stay outside the archive`).toBe(false);
  expect(
    [...persisted].sort(),
    "Classify each new table explicitly so a successful backup cannot silently omit new user data",
  ).toEqual([...backedUp, ...Object.keys(intentionalExclusions)].sort());
});
