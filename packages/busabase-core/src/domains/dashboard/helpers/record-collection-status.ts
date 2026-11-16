export interface RecordCollectionStatus {
  scope: string;
  total: number | undefined;
  totalCapped?: boolean;
  isFetching: boolean;
  isError: boolean;
}

/** Only combine current answers; any capped column makes the sum a lower bound. */
export function combineRecordCollectionStatus(
  scope: string,
  columnIds: string[],
  columns: Record<string, RecordCollectionStatus>,
): RecordCollectionStatus {
  const current = columnIds.map((id) => (columns[id]?.scope === scope ? columns[id] : undefined));
  const isError = current.some((column) => column?.isError);
  const isFetching = current.some((column) => !column || column.isFetching);
  const complete = !isError && current.every((column) => column?.total !== undefined);
  const totalCapped = complete && current.some((column) => column?.totalCapped);
  return {
    scope,
    total: complete ? current.reduce((sum, column) => sum + (column?.total ?? 0), 0) : undefined,
    ...(totalCapped ? { totalCapped: true } : {}),
    isFetching,
    isError,
  };
}
