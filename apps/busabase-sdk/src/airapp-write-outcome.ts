/**
 * Did my write land, or is it waiting for someone? — one answer for every write.
 *
 * A person's write from an AirApp leaves `autoMerge` unset, so Busabase decides
 * from that person's own permission: with write access the change lands now,
 * without it the same change becomes a ChangeRequest for someone who has it.
 * Both are correct outcomes. The app's job is to say which one happened instead
 * of assuming either, and the response is the only place that says.
 *
 * It says it in three shapes, which is why this module exists:
 *
 * - `bases.createChangeRequest` and `records.changeRequest` return either the
 *   materialized record (`materialized: true`) or the pending ChangeRequest
 *   (`materialized: false`).
 * - The bulk endpoints (`createBulkChangeRequest`,
 *   `createBulkUpdateChangeRequest`) return a ChangeRequest whose `status` is
 *   `"merged"` when it landed and `"in_review"` when it is waiting.
 * - An older server may answer with a bare record (`status: "active"`).
 *
 * 48 templates each carried `isQueued = (r) => r?.materialized === false ||
 * r?.status === "in_review"` and their own copy of the user-facing sentence. One
 * definition here means the next change to either happens once.
 */

/** Whether a write landed (`saved`) or is waiting for someone with write access (`queued`). */
export type AirAppWriteStatus = "saved" | "queued";

/** Every write response, normalized. */
export interface AirAppWriteOutcome {
  status: AirAppWriteStatus;
  /**
   * The record the write created or changed, when the response names one: the
   * materialized record's id, or for a ChangeRequest its single record target.
   * Absent for a queued create (the record does not exist yet) and for a bulk
   * write touching several records — see `recordIds`.
   */
  recordId?: string;
  /** Every record a merged bulk write produced or changed, in operation order. */
  recordIds?: string[];
  /** The ChangeRequest the write produced, when the response carries one. */
  changeRequestId?: string;
}

/** The fields of a write response this module reads. Every write response satisfies it. */
export interface AirAppWriteResponseLike {
  id?: string;
  status?: string;
  materialized?: boolean;
  /** Present on a ChangeRequest; distinguishes one from a record. */
  operations?: readonly { mergedRecordId?: string | null; targetRecordId?: string | null }[];
  primaryOperation?: { mergedRecordId?: string | null; targetRecordId?: string | null } | null;
  /** Rides along on a merged create for internal callers; usually stripped by the server. */
  changeRequestId?: string;
}

const isChangeRequestShape = (response: AirAppWriteResponseLike) =>
  Array.isArray(response.operations) || "primaryOperation" in response;

const recordIdsOf = (response: AirAppWriteResponseLike, key: "mergedRecordId" | "targetRecordId") =>
  (response.operations ?? [])
    .map((operation) => operation?.[key])
    .filter((value): value is string => typeof value === "string" && value !== "");

/**
 * The templates' `isQueued`, verbatim: the write did not land.
 *
 * Kept as its own export because 48 apps already branch on exactly this; for
 * everything else prefer {@link toAirAppWriteOutcome}.
 */
export const isAirAppWriteQueued = (response: unknown): boolean => {
  const value = response as AirAppWriteResponseLike | null | undefined;
  return value?.materialized === false || value?.status === "in_review";
};

/**
 * Normalize any write response — single create, single update, bulk create, bulk
 * update — into an {@link AirAppWriteOutcome}.
 *
 * `queued` when `materialized === false` or `status === "in_review"` (the
 * contract's pending branch). Also `queued` for a ChangeRequest in any other
 * not-merged state (`changes_requested`, `conflict`, …): a fresh write does not
 * normally come back in one, and if it ever does, "saved" would be a claim the
 * response does not support. Everything else — a materialized record, a merged
 * ChangeRequest, a bare record from an older server — is `saved`.
 */
export function toAirAppWriteOutcome(response: unknown): AirAppWriteOutcome {
  const value = (response ?? {}) as AirAppWriteResponseLike;
  const changeRequest = isChangeRequestShape(value);
  const queued =
    isAirAppWriteQueued(value) ||
    (changeRequest && value.materialized !== true && value.status !== "merged");

  if (queued) {
    const targets = recordIdsOf(value, "targetRecordId");
    const target =
      value.primaryOperation?.targetRecordId ?? (targets.length === 1 ? targets[0] : undefined);
    return {
      status: "queued",
      ...(target ? { recordId: target } : {}),
      ...(value.id ? { changeRequestId: value.id } : {}),
    };
  }

  if (changeRequest) {
    // A merged ChangeRequest (the bulk endpoints): its operations name what landed.
    const merged = recordIdsOf(value, "mergedRecordId");
    return {
      status: "saved",
      ...(merged.length === 1 ? { recordId: merged[0] } : {}),
      ...(merged.length ? { recordIds: merged } : {}),
      ...(value.id ? { changeRequestId: value.id } : {}),
    };
  }

  // A record: the materialized branch of a single write, or a bare record.
  return {
    status: "saved",
    ...(value.id ? { recordId: value.id } : {}),
    ...(value.changeRequestId ? { changeRequestId: value.changeRequestId } : {}),
  };
}

/** The sentence an app shows for each outcome. */
export interface AirAppWriteMessages {
  saved: string;
  queued: string;
}

/**
 * Default copy. `queued` says *why* it is waiting (no write access here) and
 * *what happens next* (someone who has it approves) — the two things a person
 * who just clicked Save needs, so it does not read as "nothing happened".
 *
 * Locales outside this table fall back to `en`; an app passes its own strings
 * through `messages` for those, or to change the wording.
 */
export const AIRAPP_WRITE_MESSAGES: Readonly<Record<string, Readonly<AirAppWriteMessages>>> =
  Object.freeze({
    en: {
      saved: "Saved.",
      queued:
        "Sent for review. You don't have write access here, so this waits until someone who does approves it.",
    },
    "zh-CN": {
      saved: "已保存。",
      queued: "已提交审核。你在这里没有写权限，需要有写权限的人批准后才会生效。",
    },
    "zh-TW": {
      saved: "已儲存。",
      queued: "已送出審核。你在這裡沒有寫入權限，需要有寫入權限的人核准後才會生效。",
    },
    ja: {
      saved: "保存しました。",
      queued:
        "レビューに送信しました。ここでの書き込み権限がないため、書き込み権限のある人が承認するまで反映されません。",
    },
  });

/**
 * Pick the closest table entry: exact tag, then Traditional/Simplified Chinese by
 * script or region, then the bare language, then `en`.
 */
export function resolveAirAppWriteLocale(locale: string | undefined): string {
  if (!locale) return "en";
  if (AIRAPP_WRITE_MESSAGES[locale]) return locale;
  const lower = locale.toLowerCase();
  if (lower.startsWith("zh")) {
    return /-(?:hant|tw|hk|mo)\b/.test(lower) ? "zh-TW" : "zh-CN";
  }
  const language = lower.split(/[-_]/)[0];
  return AIRAPP_WRITE_MESSAGES[language] ? language : "en";
}

export interface AirAppWriteMessageOptions {
  /** BCP 47 tag. Defaults to `navigator.language`, then `en`. */
  locale?: string;
  /** The app's own wording; wins over the defaults for whichever keys it sets. */
  messages?: Partial<AirAppWriteMessages>;
}

/**
 * The sentence to show after a write.
 *
 * @example
 * ```js
 * const outcome = await records.upsert({ ... });
 * state.notice = airAppWriteMessage(outcome, { locale: currentLocale() });
 * ```
 */
export function airAppWriteMessage(
  outcome: Pick<AirAppWriteOutcome, "status">,
  options: AirAppWriteMessageOptions = {},
): string {
  const browserLocale =
    typeof globalThis.navigator === "object" ? globalThis.navigator?.language : undefined;
  const table = AIRAPP_WRITE_MESSAGES[resolveAirAppWriteLocale(options.locale ?? browserLocale)];
  const key: keyof AirAppWriteMessages = outcome.status === "queued" ? "queued" : "saved";
  return options.messages?.[key] ?? table[key];
}
