import "server-only";

import type { DumpTable } from "busabase-contract/domains/dump/types";
import {
  attachments,
  busabaseAssets,
  busabaseAssetTexts,
  busabaseAssetUsages,
  busabaseAuditEvents,
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseComments,
  busabaseCommits,
  busabaseFieldValues,
  busabaseNodePrincipals,
  busabaseNodes,
  busabaseOperations,
  busabaseRecordLinks,
  busabaseRecords,
  busabaseReviews,
  busabaseViews,
} from "../../../db/schema";

/**
 * Every table the dump domain may raw-read/raw-write, keyed by the contract's
 * `DumpTable` enum. All entries share the shape every dump handler relies on:
 * a `text("id").primaryKey()` column and a `spaceIdColumn()`. Deliberately
 * excludes `busabase_vault_items` and the webhook tables (secrets) — those
 * never enter this registry, so they can never be exported or imported here
 * even by a future accident, not just by omission in the caller's table list.
 */
export const DUMP_TABLE_REGISTRY = {
  nodes: busabaseNodes,
  // Node-level access grants. Not a secret (unlike vault items / webhook
  // secrets) — a full-fidelity restore must recreate them or the restored
  // space silently loses every sharing/permission grant. Materialized
  // inherited rows are dumped as-is alongside direct grants, so the exact
  // post-materialization ACL state is restored (import inserts rows raw, which
  // does not re-run `recomputeSpaceNodeAcl`, so nothing recreates them for us).
  nodePrincipals: busabaseNodePrincipals,
  bases: busabaseBases,
  baseFields: busabaseBaseFields,
  views: busabaseViews,
  records: busabaseRecords,
  fieldValues: busabaseFieldValues,
  recordLinks: busabaseRecordLinks,
  // `busabase_attachments` (open-domains) has a nullable `spaceId`, unlike the
  // rest of this registry — legacy/local-mode rows leave it null. Export still
  // scopes correctly (a null spaceId row never matches `eq(spaceId, ctx)` and
  // is simply not dumped), which is the intended, non-leaking behavior.
  attachments,
  assets: busabaseAssets,
  assetUsages: busabaseAssetUsages,
  assetTexts: busabaseAssetTexts,
  commits: busabaseCommits,
  changeRequests: busabaseChangeRequests,
  operations: busabaseOperations,
  comments: busabaseComments,
  reviews: busabaseReviews,
  auditEvents: busabaseAuditEvents,
} as const satisfies Record<DumpTable, { id: unknown; spaceId: unknown }>;

/**
 * Import dependency order — parents before children (FK-safe insert order).
 * `docBodies` (object storage, not a row) is handled separately by the import
 * handler and does not appear here.
 */
export const DUMP_IMPORT_ORDER: DumpTable[] = [
  "nodes",
  // After `nodes`: `nodeId` and `sourceNodeId` both FK into busabase_nodes.
  "nodePrincipals",
  "bases",
  "baseFields",
  "views",
  "commits",
  "changeRequests",
  "operations",
  "records",
  "fieldValues",
  "recordLinks",
  "attachments",
  "assets",
  "assetUsages",
  "assetTexts",
  "comments",
  "reviews",
  "auditEvents",
];
