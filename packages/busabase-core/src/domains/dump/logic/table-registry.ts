import "server-only";

import { ORPCError } from "@orpc/server";
import type { DumpTable } from "busabase-contract/domains/dump/types";
import { and, eq, exists, getTableColumns, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { BusabaseDatabase } from "../../../context";
import {
  attachments,
  busabaseAgentSessionCommands,
  busabaseAgentSessionEvents,
  busabaseAgentSessions,
  busabaseAssets,
  busabaseAssetTexts,
  busabaseAssetUsages,
  busabaseAuditEvents,
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseCommentMentions,
  busabaseComments,
  busabaseCommits,
  busabaseEmbedLinks,
  busabaseFavorites,
  busabaseFieldValues,
  busabaseForms,
  busabaseNodePrincipals,
  busabaseNodeShares,
  busabaseNodeSubscriptions,
  busabaseNodes,
  busabaseOperations,
  busabaseRecordLinks,
  busabaseRecords,
  busabaseReviews,
  busabaseRouterConnections,
  busabaseRouterGrants,
  busabaseSpaceInstructions,
  busabaseSpaceWelcome,
  busabaseViews,
  busabaseWebhookDeliveries,
  busabaseWebhookRules,
  busabaseWorkflowRuns,
  busabaseWorkflowTriggers,
} from "../../../db/schema";

/**
 * Every table the dump domain may raw-read/raw-write, keyed by the contract's
 * `DumpTable` enum. All entries share the shape every dump handler relies on:
 * a stable primary-key identity plus an explicit tenant predicate (including
 * singleton spaceId keys and children scoped through their parent). Deliberately
 * excludes dedicated Vault values, one-use OAuth/secret-enrollment state and
 * rebuildable indexes/outboxes. Webhook rules retain nonsecret configuration
 * with an explicit signing-credential exclusion marker and disabled recovery.
 * User-authored JSON/text and access-control password verifiers stay intact.
 */
export const DUMP_TABLE_REGISTRY = {
  nodes: busabaseNodes,
  nodePrincipals: busabaseNodePrincipals,
  nodeShares: busabaseNodeShares,
  favorites: busabaseFavorites,
  nodeSubscriptions: busabaseNodeSubscriptions,
  spaceInstructions: busabaseSpaceInstructions,
  spaceWelcome: busabaseSpaceWelcome,
  embedLinks: busabaseEmbedLinks,
  bases: busabaseBases,
  baseFields: busabaseBaseFields,
  views: busabaseViews,
  forms: busabaseForms,
  commits: busabaseCommits,
  changeRequests: busabaseChangeRequests,
  operations: busabaseOperations,
  records: busabaseRecords,
  fieldValues: busabaseFieldValues,
  recordLinks: busabaseRecordLinks,
  attachments: attachments,
  assets: busabaseAssets,
  assetUsages: busabaseAssetUsages,
  assetTexts: busabaseAssetTexts,
  comments: busabaseComments,
  commentMentions: busabaseCommentMentions,
  reviews: busabaseReviews,
  auditEvents: busabaseAuditEvents,
  workflowRuns: busabaseWorkflowRuns,
  workflowTriggers: busabaseWorkflowTriggers,
  webhookRules: busabaseWebhookRules,
  webhookDeliveries: busabaseWebhookDeliveries,
  agentSessions: busabaseAgentSessions,
  agentSessionEvents: busabaseAgentSessionEvents,
  agentSessionCommands: busabaseAgentSessionCommands,
  routerGrants: busabaseRouterGrants,
  routerConnections: busabaseRouterConnections,
} as const;

/**
 * Import dependency order — parents before children (FK-safe insert order).
 * `docBodies` (object storage, not a row) is handled separately by the import
 * handler and does not appear here.
 */
export const DUMP_IMPORT_ORDER: DumpTable[] = [
  "nodes",
  "nodePrincipals",
  "nodeShares",
  "favorites",
  "nodeSubscriptions",
  "spaceInstructions",
  "spaceWelcome",
  "embedLinks",
  "bases",
  "baseFields",
  "views",
  "forms",
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
  "commentMentions",
  "reviews",
  "auditEvents",
  "workflowRuns",
  "workflowTriggers",
  "webhookRules",
  "webhookDeliveries",
  "agentSessions",
  "agentSessionEvents",
  "agentSessionCommands",
  "routerGrants",
  "routerConnections",
];

export const dumpIdentityKey = (table: DumpTable): "id" | "spaceId" =>
  table === "spaceInstructions" || table === "spaceWelcome" ? "spaceId" : "id";

export const dumpIdentityColumn = (table: DumpTable): AnyPgColumn => {
  const columns = getTableColumns(DUMP_TABLE_REGISTRY[table] as never) as Record<
    string,
    AnyPgColumn
  >;
  return columns[dumpIdentityKey(table)];
};

/** Every raw export, collision check and rollback uses the same tenant predicate. */
export const dumpSpaceScope = (
  db: Pick<BusabaseDatabase, "select">,
  table: DumpTable,
  spaceId: string,
): SQL => {
  if (table === "attachments")
    return or(
      eq(attachments.spaceId, spaceId),
      and(
        isNull(attachments.spaceId),
        exists(
          db
            .select({ id: busabaseAssets.id })
            .from(busabaseAssets)
            .where(
              and(
                eq(busabaseAssets.spaceId, spaceId),
                eq(busabaseAssets.attachmentId, attachments.id),
              ),
            ),
        ),
      ),
    ) as SQL;
  if (table === "commentMentions")
    return exists(
      db
        .select({ id: busabaseComments.id })
        .from(busabaseComments)
        .where(
          and(
            eq(busabaseComments.spaceId, spaceId),
            eq(busabaseComments.id, busabaseCommentMentions.commentId),
          ),
        ),
    );
  if (table === "agentSessionEvents")
    return exists(
      db
        .select({ id: busabaseAgentSessions.id })
        .from(busabaseAgentSessions)
        .where(
          and(
            eq(busabaseAgentSessions.spaceId, spaceId),
            eq(busabaseAgentSessions.id, busabaseAgentSessionEvents.sessionId),
          ),
        ),
    );
  if (table === "routerConnections")
    return exists(
      db
        .select({ id: busabaseRouterGrants.id })
        .from(busabaseRouterGrants)
        .where(
          and(
            eq(busabaseRouterGrants.busabaseSpaceId, spaceId),
            eq(busabaseRouterGrants.id, busabaseRouterConnections.grantId),
          ),
        ),
    );
  if (table === "routerGrants") return eq(busabaseRouterGrants.busabaseSpaceId, spaceId);
  const columns = getTableColumns(DUMP_TABLE_REGISTRY[table] as never) as Record<
    string,
    AnyPgColumn
  >;
  if (!columns.spaceId) throw new Error(`Dump table ${table} has no tenant scope descriptor`);
  return eq(columns.spaceId, spaceId);
};

export const stampDumpRow = (
  table: DumpTable,
  row: Record<string, unknown>,
  spaceId: string,
): Record<string, unknown> => {
  const columns = getTableColumns(DUMP_TABLE_REGISTRY[table] as never);
  if (Object.hasOwn(columns, "spaceId")) return { ...row, spaceId };
  if (table === "routerGrants") return { ...row, busabaseSpaceId: spaceId };
  return { ...row };
};

/** Child tables without a tenant column must never attach to another space. */
export const assertDumpChildParents = async (
  db: Pick<BusabaseDatabase, "select">,
  table: DumpTable,
  rows: Record<string, unknown>[],
  spaceId: string,
): Promise<void> => {
  const references: Array<{ key: string; parent: DumpTable }> =
    table === "commentMentions"
      ? [{ key: "commentId", parent: "comments" }]
      : table === "agentSessionEvents" || table === "agentSessionCommands"
        ? [{ key: "sessionId", parent: "agentSessions" }]
        : table === "routerConnections"
          ? [{ key: "grantId", parent: "routerGrants" }]
          : table === "forms"
            ? [
                { key: "nodeId", parent: "nodes" },
                { key: "targetBaseId", parent: "bases" },
              ]
            : table === "nodeShares" || table === "favorites" || table === "nodeSubscriptions"
              ? [{ key: "nodeId", parent: "nodes" }]
              : [];
  for (const { key, parent } of references) {
    const ids = [...new Set(rows.map((row) => row[key]))];
    if (ids.some((id) => typeof id !== "string" || !id))
      throw new ORPCError("BAD_REQUEST", { message: `Restore ${table} has invalid ${key}` });
    const identity = dumpIdentityColumn(parent);
    const found = new Set<string>();
    for (let offset = 0; offset < ids.length; offset += 2000) {
      const values = await db
        .select({ id: identity })
        .from(DUMP_TABLE_REGISTRY[parent] as never)
        .where(
          and(
            inArray(identity, ids.slice(offset, offset + 2000) as string[]),
            dumpSpaceScope(db, parent, spaceId),
          ),
        );
      for (const value of values as unknown as Array<{ id: string }>) found.add(value.id);
    }
    if (ids.some((id) => !found.has(id as string)))
      throw new ORPCError("FORBIDDEN", {
        message: `Restore ${table} references a ${key} missing from the target space`,
      });
  }
};
