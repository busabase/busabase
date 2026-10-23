/**
 * Record reads and writes for an AirApp, bound to one client — the plumbing
 * every template's `busabase-provider.js` carried its own copy of.
 *
 * Counted across the 64 templates: `readPage` ×54, `findRecord` ×42, `upsert`
 * ×31. The copies agreed on the core and differed only in app-specific business
 * rules (which procedures the app allowed itself, how a record maps onto the
 * app's own row shape, which Base and sort to use). This module is that core and
 * nothing else; the business rules stay in the app.
 *
 * **No helper here ever passes `autoMerge`.** A person's write follows their own
 * permission: Busabase merges it for someone with write access and opens a
 * ChangeRequest for someone without. Forcing review from the app — an explicit
 * `false`, or a value worked out from where the app is running — made every
 * owner approve their own click in the inbox; that fix had to be applied to 49
 * copies. Read the outcome instead: every write here returns
 * {@link AirAppWriteOutcome}.
 *
 * Isomorphic, browser-safe: the only I/O is the passed-in client.
 *
 * @example
 * ```js
 * import { createBusabaseClient } from "../vendor/busabase-sdk.js";
 * import { airAppWriteMessage, createAirAppRecords } from "../vendor/busabase-airapp.js";
 *
 * const records = createAirAppRecords(createBusabaseClient({ baseUrl: window.location.origin }), {
 *   appId: "busa-crm",
 * });
 *
 * const { records: rows, nextCursor } = await records.readPage({ baseId, limit: 50, cursor });
 * const contact = await records.findRecord({ baseId, fieldSlug: "contact-id", valueText: "c-42" });
 * const outcome = await records.upsert({
 *   baseId,
 *   fieldSlug: "followup-id",
 *   valueText: "fu-7",
 *   fields: { "followup-id": "fu-7", status: "approved" },
 *   message: "Approve follow-up fu-7",
 * });
 * notice = airAppWriteMessage(outcome, { locale }); // "Saved." or "Sent for review. …"
 * ```
 */

import type { RecordVO } from "busabase-contract/types";
import { type AirAppWriteOutcome, toAirAppWriteOutcome } from "./airapp-write-outcome.js";
import type { BusabaseClient } from "./client.js";

type ListRecordsInput = NonNullable<Parameters<BusabaseClient["records"]["list"]>[0]>;

/** The client surface these helpers need. Both `BusabaseClient` and `Busabase#client` satisfy it. */
export type AirAppRecordsClient = {
  records: Pick<BusabaseClient["records"], "list" | "get" | "changeRequest">;
  bases: Pick<BusabaseClient["bases"], "createChangeRequest">;
};

/**
 * A record as these helpers return it: the canonical `RecordVO`, plus `fields` —
 * its current field values keyed by slug, already pulled out of `headCommit`.
 * Every copy re-derived that line (`record.headCommit?.payload ||
 * record.headCommit?.fields || record.fields`); now it is a property.
 */
export type AirAppRecord = RecordVO & { fields: Record<string, unknown> };

/** One page of records and the cursor for the next, `null` at the end. */
export interface AirAppRecordPage {
  records: AirAppRecord[];
  nextCursor: string | null;
}

export interface AirAppReadPageInput {
  baseId: string;
  /**
   * The page budget for this one read — the app's declared `readLimit`. Defaults
   * to 50, the documented interactive budget. One call reads one page; the next
   * page is a separate call made for a separate user action.
   */
  limit?: number;
  /** The previous page's `nextCursor`. `null`/`undefined`/`""` reads the first page. */
  cursor?: string | null;
  /** View filters (a best-effort superset — see `records.list`). */
  filters?: ListRecordsInput["filters"];
  /** Exact value comparisons — see `records.list`. */
  valueFilters?: ListRecordsInput["valueFilters"];
  /** One number or date field to sort by — see `records.list`. */
  sort?: ListRecordsInput["sort"];
}

export interface AirAppFindRecordInput {
  baseId: string;
  /** The field to match on, by slug — usually the app's business id (`"contact-id"`). */
  fieldSlug: string;
  /** The exact text value to match. */
  valueText: string;
}

export interface AirAppCreateRecordInput {
  baseId: string;
  /** Field values keyed by field slug, exactly as the Base declares them. */
  fields: Record<string, unknown>;
  /** Shown to whoever reviews it if it is queued. */
  message?: string;
  /** Dedupes a retried create (after a timeout, say) — see `bases.createChangeRequest`. */
  idempotencyKey?: string;
}

export interface AirAppUpdateRecordInput {
  /** The record to change. */
  recordId: string;
  /**
   * The `headCommitId` the change was made against, for optimistic concurrency:
   * a record someone else changed in the meantime is not silently overwritten.
   * Pass the one from the record you read.
   */
  baseCommitId?: string;
  /** The fields to change, keyed by slug. Fields not named keep their value. */
  fields: Record<string, unknown>;
  message?: string;
}

export interface AirAppUpsertRecordInput extends AirAppFindRecordInput {
  /**
   * Field values keyed by slug. On a create, the match field is filled in with
   * `valueText` when `fields` leaves it out — otherwise the record could never
   * be found by this same upsert again, and every call would create another.
   */
  fields: Record<string, unknown>;
  message?: string;
}

/** The outcome of a single write, with the raw response kept for anything app-specific. */
export interface AirAppWriteResult extends AirAppWriteOutcome {
  /** The server's response, unchanged. */
  response: unknown;
}

/** An upsert's outcome, plus which of the two writes it made. */
export interface AirAppUpsertResult extends AirAppWriteResult {
  action: "create" | "update";
}

export interface AirAppRecordsOptions {
  /**
   * Recorded as `submittedBy` on creates and `author` on updates, so a reviewer
   * can see which app proposed the change. Omit to use the server's default.
   */
  appId?: string;
}

export interface AirAppRecords {
  /** Read one page. Never loops: the next page is the caller's next call. */
  readPage(input: AirAppReadPageInput): Promise<AirAppRecordPage>;
  /** The one record whose `fieldSlug` is exactly `valueText`, or `null` when there is none. */
  findRecord(input: AirAppFindRecordInput): Promise<AirAppRecord | null>;
  /** Create a record. Permission-aware: never passes `autoMerge`. */
  createRecord(input: AirAppCreateRecordInput): Promise<AirAppWriteResult>;
  /** Change a record. Permission-aware: never passes `autoMerge`. */
  updateRecord(input: AirAppUpdateRecordInput): Promise<AirAppWriteResult>;
  /**
   * Update the record whose `fieldSlug` is exactly `valueText`, or create one
   * when there is none. The update is made against the `headCommitId` it just
   * read. Permission-aware: never passes `autoMerge`.
   */
  upsert(input: AirAppUpsertRecordInput): Promise<AirAppUpsertResult>;
}

/** The `fields` property: the record's current values, out of its head commit. */
export function airAppRecordFields(record: unknown): Record<string, unknown> {
  const value = record as {
    headCommit?: { payload?: unknown; fields?: unknown } | null;
    fields?: unknown;
  } | null;
  const fields = value?.headCommit?.payload ?? value?.headCommit?.fields ?? value?.fields;
  return fields && typeof fields === "object" && !Array.isArray(fields)
    ? (fields as Record<string, unknown>)
    : {};
}

// A private copy rather than an import of `airapp.ts`'s: that module re-exports
// this one, and the cycle is not worth four lines.
const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (("code" in error && error.code === "NOT_FOUND") || ("status" in error && error.status === 404));

const withFields = (record: RecordVO): AirAppRecord => ({
  ...record,
  fields: airAppRecordFields(record),
});

/**
 * Bind the record helpers to one client.
 *
 * The client is whatever the app already built — in an AirApp that is
 * `createBusabaseClient({ baseUrl: window.location.origin })`, authenticated by
 * the viewer's ambient session when hosted and by the local gateway's proxy when
 * standalone. These helpers do not care which.
 */
export function createAirAppRecords(
  client: AirAppRecordsClient,
  options: AirAppRecordsOptions = {},
): AirAppRecords {
  const { appId } = options;

  const readPage: AirAppRecords["readPage"] = async (input) => {
    const result = (await client.records.list({
      baseId: input.baseId,
      // 50 = `AIRAPP_DEFAULT_READ_LIMIT`, the documented interactive budget. Not
      // imported: that lives in the checker, which has no business in a browser bundle.
      limit: input.limit ?? 50,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.filters ? { filters: input.filters } : {}),
      ...(input.valueFilters ? { valueFilters: input.valueFilters } : {}),
      ...(input.sort ? { sort: input.sort } : {}),
    })) as unknown;
    // A server from before `/records` was paginated answered a bare array — and
    // ignored `baseId` while doing it, returning the whole space. Keep only this
    // Base's rows so an old deployment shows less, never someone else's data.
    if (Array.isArray(result)) {
      return {
        records: (result as RecordVO[])
          .filter((record) => record?.baseId === input.baseId)
          .map(withFields),
        nextCursor: null,
      };
    }
    const page = result as { records?: RecordVO[]; nextCursor?: string | null } | null;
    return {
      records: (page?.records ?? []).map(withFields),
      nextCursor: page?.nextCursor || null,
    };
  };

  const findRecord: AirAppRecords["findRecord"] = async ({ baseId, fieldSlug, valueText }) => {
    // The server rejects an empty selector with a 400; nothing can match it anyway.
    if (!valueText) return null;
    try {
      return withFields(await client.records.get({ baseId, fieldSlug, valueText }));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  };

  const createRecord: AirAppRecords["createRecord"] = async (input) => {
    const response = await client.bases.createChangeRequest({
      baseId: input.baseId,
      fields: input.fields,
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(appId ? { submittedBy: appId } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      // `autoMerge` deliberately absent — see the module comment.
    });
    return { ...toAirAppWriteOutcome(response), response };
  };

  const updateRecord: AirAppRecords["updateRecord"] = async (input) => {
    const response = await client.records.changeRequest({
      recordId: input.recordId,
      operation: "update",
      fields: input.fields,
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(appId ? { author: appId } : {}),
      ...(input.baseCommitId ? { baseCommitId: input.baseCommitId } : {}),
      // `autoMerge` deliberately absent — see the module comment.
    });
    return { ...toAirAppWriteOutcome(response), response };
  };

  const upsert: AirAppRecords["upsert"] = async (input) => {
    if (!input.valueText) {
      throw new Error(
        `upsert: valueText for ${input.fieldSlug} is empty, so there is no record to match — pass the record's business id`,
      );
    }
    const existing = await findRecord(input);
    if (existing) {
      const result = await updateRecord({
        recordId: existing.id,
        baseCommitId: existing.headCommitId,
        fields: input.fields,
        message: input.message,
      });
      return { ...result, action: "update" };
    }
    const fields =
      input.fieldSlug in input.fields
        ? input.fields
        : { ...input.fields, [input.fieldSlug]: input.valueText };
    const result = await createRecord({ baseId: input.baseId, fields, message: input.message });
    return { ...result, action: "create" };
  };

  return { readPage, findRecord, createRecord, updateRecord, upsert };
}
