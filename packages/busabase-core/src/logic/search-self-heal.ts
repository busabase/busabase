import "server-only";

import { and, asc, eq, gt, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { DbInstance } from "../db";
import { busabaseNodeContentSearch, busabaseNodes } from "../db/schema";
import {
  isSearchableNodeType,
  reindexNodeContent,
  SEARCHABLE_NODE_TYPES,
  type SearchableNodeType,
} from "./node-content";

/** How many unindexed nodes one lookup reads; the run keeps paging past them. */
const SELF_HEAL_BATCH = 25;
/**
 * Storage reads in flight at once during one run. Measured against MinIO with an
 * 80 ms round trip, 801 nodes took 80 s at 1, 23 s at 4 and 15 s at 8; 4 stays
 * below the 5-connection primary pool used when a read replica is configured.
 */
const SELF_HEAL_CONCURRENCY = 4;
/** One search starts at most this much storage work, and never waits for all of it. */
const SELF_HEAL_RUN_MS = 30_000;
/** A node that could not be read is not retried until this has passed. */
const SELF_HEAL_FAILURE_COOLDOWN_MS = 10 * 60_000;
const SELF_HEAL_MAX_REMEMBERED_FAILURES = 10_000;

const runningBySpace = new Map<string, Promise<boolean>>();
const failedUntilByNode = new Map<string, number>();

const rememberFailure = (nodeId: string): void => {
  if (failedUntilByNode.size >= SELF_HEAL_MAX_REMEMBERED_FAILURES) failedUntilByNode.clear();
  failedUntilByNode.set(nodeId, Date.now() + SELF_HEAL_FAILURE_COOLDOWN_MS);
};

const isCoolingDown = (nodeId: string): boolean => {
  const until = failedUntilByNode.get(nodeId);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  failedUntilByNode.delete(nodeId);
  return false;
};

/**
 * Index every content-bearing node with no projection row, resolving to whether
 * the index is now as complete as storage allows. Pages by id so nodes that fail
 * cannot hold the same batch forever and starve the nodes behind them.
 */
const runSelfHeal = async (db: DbInstance, spaceId: string): Promise<boolean> => {
  const deadline = Date.now() + SELF_HEAL_RUN_MS;
  let complete = true;
  let cursor: string | undefined;
  while (true) {
    const stale = await db
      .select({ id: busabaseNodes.id, type: busabaseNodes.type })
      .from(busabaseNodes)
      .where(
        and(
          eq(busabaseNodes.spaceId, spaceId),
          isNull(busabaseNodes.archivedAt),
          inArray(busabaseNodes.type, SEARCHABLE_NODE_TYPES),
          cursor ? gt(busabaseNodes.id, cursor) : undefined,
          notExists(
            db
              .select({ one: sql`1` })
              .from(busabaseNodeContentSearch)
              .where(eq(busabaseNodeContentSearch.nodeId, busabaseNodes.id)),
          ),
        ),
      )
      .orderBy(asc(busabaseNodes.id))
      .limit(SELF_HEAL_BATCH);

    cursor = stale.at(-1)?.id;
    const pending = stale.filter(
      (node) => !isCoolingDown(node.id) && isSearchableNodeType(node.type),
    );
    // Storage latency, not the database, bounds this loop, so reads overlap.
    const workers = Array.from({ length: SELF_HEAL_CONCURRENCY }, async () => {
      for (let node = pending.shift(); node; node = pending.shift()) {
        if (Date.now() >= deadline) {
          complete = false;
          return;
        }
        const indexed = await reindexNodeContent(db, {
          nodeId: node.id,
          spaceId,
          nodeType: node.type as SearchableNodeType,
        });
        if (!indexed) {
          rememberFailure(node.id);
          complete = false;
        }
      }
    });
    await Promise.all(workers);
    if (Date.now() >= deadline) return false;
    if (stale.length < SELF_HEAL_BATCH) return complete;
  }
};

/**
 * The lazy backfill for workspaces that predate a searchable node type (spec D3),
 * kept off the search budget: storage reads have no relation to the query, and a
 * workspace with many unindexed nodes must not answer every search with a timeout.
 *
 * Waits `waitMs` so a small backfill is still visible to the search that started
 * it, then lets it finish in the background; one run per space per process.
 * Resolves to whether the index can be treated as complete for this search.
 */
export const healNodeProjections = async (
  db: DbInstance,
  spaceId: string,
  waitMs: number,
): Promise<boolean> => {
  let run = runningBySpace.get(spaceId);
  if (!run) {
    // A failing backfill reports an incomplete index; it never fails the search.
    run = runSelfHeal(db, spaceId)
      .catch(() => false)
      .finally(() => runningBySpace.delete(spaceId));
    runningBySpace.set(spaceId, run);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), waitMs);
  });
  try {
    return await Promise.race([run, timedOut]);
  } finally {
    clearTimeout(timer);
  }
};

/** For tests and scripts: settle after every backfill in this process has finished. */
export const waitForNodeSelfHeal = async (): Promise<void> => {
  while (runningBySpace.size > 0) {
    await Promise.allSettled([...runningBySpace.values()]);
  }
};
