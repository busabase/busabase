/**
 * Warm the rebuildable attachment text search projection from existing text
 * slots. No original binary file is extracted or changed.
 *
 * BACKFILL_SPACE_ID=... pnpm --filter busabase-core backfill:asset-text-search
 * Optional BACKFILL_AFTER_ASSET_ID resumes after a logged cursor. Successful
 * projections are skipped, so restarting without a cursor retries failures.
 */
import { getDb } from "../src/db";
import {
  auditAssetTextSearch,
  backfillAssetTextSearch,
} from "../src/domains/assets/logic/asset-text-search-logic";

const main = async () => {
  const db = await getDb();
  try {
    const spaceId = process.env.BACKFILL_SPACE_ID || undefined;
    let afterAssetId = process.env.BACKFILL_AFTER_ASSET_ID || undefined;
    let failed = 0;
    let indexed = 0;
    do {
      const page = await backfillAssetTextSearch(db, { spaceId, afterAssetId, limit: 25 });
      indexed += page.indexed;
      failed += page.failed;
      afterAssetId = page.nextCursor;
      // One machine-readable receipt per page, including a retry queue. No
      // filenames/content are printed. Save stdout to retain a durable cursor.
      console.log(JSON.stringify({ ...page, spaceId, totalIndexed: indexed, totalFailed: failed }));
    } while (afterAssetId);
    const audit = await auditAssetTextSearch(db, { spaceId });
    console.log(
      JSON.stringify({
        event: "reconciliation",
        spaceId,
        ...audit,
        totalIndexed: indexed,
        totalFailed: failed,
      }),
    );
    // Partial (capped) projections are expected for very large sources and
    // are listed in the receipt; only missing projections or failures fail.
    if (!audit.complete || failed > 0) {
      console.error(
        `Incomplete search index: ${audit.missing} missing, ${failed} failures in this run.`,
      );
      process.exitCode = 1;
    }
  } finally {
    // Allow JSON receipts to flush naturally, then release the standalone
    // script's database handles instead of leaving the Postgres pool alive.
    const client = db.$client;
    if ("end" in client) await client.end({ timeout: 5 });
    else await client.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
