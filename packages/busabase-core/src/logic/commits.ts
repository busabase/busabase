/**
 * The single write path into `busabase_commits`.
 *
 * Every commit insert in the codebase goes through `insertCommit`, which parses
 * the payload against the schema for its `operation` before touching the db.
 * That makes "a malformed payload cannot enter the ledger" a structural
 * property of the system rather than something each of the ~27 call sites has
 * to remember. Before this, the first thing that ever looked at a payload's
 * shape was the merge handler — arbitrarily far in time and code from wherever
 * the bad commit was created.
 *
 * See `./commit-payload-schemas.ts` for why the read side stays deliberately
 * loose while this write side is strict.
 */
import type { getDb } from "../db";
import { busabaseCommits } from "../db/schema";
import { assertCommitPayload, type CommitOperationKind } from "./commit-payload-schemas";

/** The db handle or an open transaction — both satisfy `.insert().values()`. */
type CommitWriter = Awaited<ReturnType<typeof getDb>>;

type CommitInsert = typeof busabaseCommits.$inferInsert;

/**
 * Values accepted by `insertCommit`. Identical to drizzle's insert type except
 * `operation` is narrowed to the closed enum union (drizzle already types it
 * that way) and `payload` is required — a commit with no payload is never
 * meaningful, and the column is NOT NULL anyway.
 */
export interface InsertCommitValues extends Omit<CommitInsert, "operation" | "payload"> {
  operation: CommitOperationKind;
  payload: Record<string, unknown>;
}

/**
 * Insert one commit, validating its payload against its operation's schema
 * first. Throws `CommitPayloadError` (naming the operation and the offending
 * path) rather than writing a row that only fails at merge time.
 *
 * The payload written is the caller's original object, not Zod's output, so
 * validation can never quietly reshape an append-only ledger entry.
 */
export const insertCommit = async (db: CommitWriter, values: InsertCommitValues) => {
  const payload = assertCommitPayload(values.operation, values.payload);
  await db.insert(busabaseCommits).values({ ...values, payload });
};
