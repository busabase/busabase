import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseVO, ViewVO } from "busabase-contract/types";
import { retryRecordRead } from "../helpers/query-state";
import type { RecordPageSize } from "../helpers/record-pagination-url";
import { resolveViewGrouping } from "../helpers/view-grouping";

/**
 * Whether the open view reads its own records instead of the Base page's
 * `records.listPage`: Kanban pages columns, grouped tables page groups, and
 * calendar/timeline views read their date windows.
 */
export const viewReadsOwnRecords = (
  view: Pick<ViewVO, "type" | "config"> | null | undefined,
  base: Pick<BaseVO, "fields"> | null | undefined,
): boolean =>
  view?.type === "kanban" ||
  view?.type === "calendar" ||
  view?.type === "gantt" ||
  resolveViewGrouping(view, base?.fields ?? []) !== null;

interface RecordsPageInput {
  baseId: string | undefined;
  viewId: string | undefined;
  listMode: "table" | undefined;
  find: { query: string; fieldId?: string } | undefined;
  page: number;
  pageSize: RecordPageSize;
}

/**
 * The Base page's one-page `records.listPage` read (table, gallery, and the
 * view-less grid). Disabled while the view reads its own records (see
 * `viewReadsOwnRecords`) or while the route says not to read (`blocked`).
 */
export function useRecordsPageQuery({
  base,
  blocked,
  input,
  orpc,
  view,
}: {
  base: Pick<BaseVO, "fields"> | null | undefined;
  /** A read-only preview, or a Base route still deciding which view it shows. */
  blocked: boolean;
  input: RecordsPageInput;
  orpc: BusabaseQueryUtils;
  view: Pick<ViewVO, "type" | "config"> | null | undefined;
}) {
  const readsOwnRecords = viewReadsOwnRecords(view, base);
  const query = useQuery({
    ...orpc.records.listPage.queryOptions({
      input: {
        baseId: input.baseId ?? "",
        viewId: input.viewId,
        listMode: input.listMode,
        find: input.find,
        page: input.page,
        pageSize: input.pageSize,
      },
    }),
    enabled: Boolean(input.baseId) && !readsOwnRecords && !blocked,
    retry: input.find ? false : retryRecordRead,
    placeholderData: (previousData, previousQuery) => {
      const previousInput = (
        previousQuery?.queryKey[1] as
          | {
              input?: {
                baseId?: string;
                viewId?: string;
                listMode?: "full" | "table";
                find?: { query: string; fieldId?: string };
              };
            }
          | undefined
      )?.input;
      return previousInput?.baseId === input.baseId &&
        previousInput?.viewId === input.viewId &&
        previousInput?.listMode === input.listMode &&
        previousInput?.find?.query === input.find?.query &&
        previousInput?.find?.fieldId === input.find?.fieldId
        ? previousData
        : undefined;
    },
  });
  return { query, readsOwnRecords };
}
