/**
 * Backfill the node content search projection.
 *
 * A SQL migration cannot populate `busabase_node_content_search`: the content
 * lives in object storage, not in Postgres. Searching self-heals a bounded
 * batch per request, so an upgraded workspace becomes complete on its own —
 * this script is for operators who would rather have it warm before first use,
 * and for dev/CI seeds.
 *
 * Idempotent: re-running only rewrites rows, it never duplicates them
 * (`nodeId` is the primary key).
 *
 * Usage:
 *   pnpm --filter busabase-core backfill:node-content-search
 *   BACKFILL_ONLY_MISSING=1 pnpm --filter busabase-core backfill:node-content-search
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../src/db";
import { busabaseNodeContentSearch, busabaseNodes } from "../src/db/schema";
import {
  isSearchableNodeType,
  reindexNodeContent,
  SEARCHABLE_NODE_TYPES,
} from "../src/logic/node-content";

const ONLY_MISSING = process.env.BACKFILL_ONLY_MISSING === "1";

const main = async () => {
  const db = await getDb();
  const nodes = await db
    .select({ id: busabaseNodes.id, spaceId: busabaseNodes.spaceId, type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(and(isNull(busabaseNodes.archivedAt)));

  const targets = nodes.filter((node) => isSearchableNodeType(node.type));
  console.log(
    `Found ${targets.length} content-bearing node(s) of types ${SEARCHABLE_NODE_TYPES.join("/")}.`,
  );

  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  for (const node of targets) {
    if (!isSearchableNodeType(node.type)) continue;
    if (ONLY_MISSING) {
      const [existing] = await db
        .select({ nodeId: busabaseNodeContentSearch.nodeId })
        .from(busabaseNodeContentSearch)
        .where(eq(busabaseNodeContentSearch.nodeId, node.id))
        .limit(1);
      if (existing) {
        skipped++;
        continue;
      }
    }
    const ok = await reindexNodeContent(db, {
      nodeId: node.id,
      spaceId: node.spaceId,
      nodeType: node.type,
    });
    if (ok) indexed++;
    else failed++;
  }

  console.log(`Indexed ${indexed}, skipped ${skipped}, failed ${failed}.`);
  if (failed > 0) {
    // Not fatal: a node whose content object is missing is a pre-existing data
    // problem, not a backfill failure, and the rest of the index is still valid.
    console.log("Failed nodes have no readable content object; they stay unindexed.");
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
