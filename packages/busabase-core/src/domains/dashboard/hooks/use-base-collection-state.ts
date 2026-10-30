import { useEffect, useRef, useState } from "react";
import type { RecordPaginationUrlState } from "../helpers/record-pagination-url";
import type { BaseTableViewState } from "../helpers/view-types";

const createTableState = (scope: string): BaseTableViewState => ({
  scope,
  selectedRecordIds: [],
  scrollTop: 0,
  scrollLeft: 0,
});

/** Retain the current collection while a full record/editor temporarily replaces it. */
export function useBaseCollectionState({
  identity,
  scope,
  search,
  pagination,
  onPaginationChange,
}: {
  identity: string;
  /** Resolved Base + view identity, or null outside a collection route. */
  scope: string | null;
  search: string;
  pagination: RecordPaginationUrlState;
  onPaginationChange: (
    page: number,
    pageSize: RecordPaginationUrlState["pageSize"],
    replace: boolean,
  ) => void;
}): BaseTableViewState | undefined {
  const previousCollection = useRef<{ identity: string; scope: string } | null>(null);
  useEffect(() => {
    if (previousCollection.current?.identity !== identity) previousCollection.current = null;
    if (scope === null) return;
    const previous = previousCollection.current;
    previousCollection.current = { identity, scope };
    if (previous && previous.scope !== scope && pagination.page !== 1) {
      onPaginationChange(1, pagination.pageSize, true);
    }
  }, [identity, scope, pagination.page, pagination.pageSize, onPaginationChange]);

  const fullScope = scope === null ? null : JSON.stringify([identity, scope, search]);
  const [snapshot, setSnapshot] = useState(() => ({
    identity,
    value: fullScope === null ? undefined : createTableState(fullScope),
  }));
  // A new collection/query starts fresh. Non-collection routes leave the last
  // snapshot intact, while an identity change clears it even on a record page.
  if (
    snapshot.identity !== identity ||
    (fullScope !== null && snapshot.value?.scope !== fullScope)
  ) {
    const next = {
      identity,
      value: fullScope === null ? undefined : createTableState(fullScope),
    };
    setSnapshot(next);
    return next.value;
  }
  return fullScope === null ? undefined : snapshot.value;
}
