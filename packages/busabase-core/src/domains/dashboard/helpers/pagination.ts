export type PaginationItemValue = number | "ellipsis-start" | "ellipsis-end";

const range = (start: number, end: number): number[] =>
  Array.from({ length: Math.max(end - start + 1, 0) }, (_, index) => start + index);

export const clampPaginationPage = (page: number, totalPages: number): number =>
  Math.min(Math.max(Math.trunc(page) || 1, 1), Math.max(Math.trunc(totalPages) || 1, 1));

export const getPaginationItems = (
  page: number,
  totalPages: number,
  siblingCount = 1,
): PaginationItemValue[] => {
  const safeTotalPages = Math.max(Math.trunc(totalPages) || 1, 1);
  const safePage = clampPaginationPage(page, safeTotalPages);
  const safeSiblingCount = Math.max(Math.trunc(siblingCount) || 0, 0);
  const visibleItemCount = safeSiblingCount * 2 + 5;

  if (safeTotalPages <= visibleItemCount) {
    return range(1, safeTotalPages);
  }

  const leftSibling = Math.max(safePage - safeSiblingCount, 1);
  const rightSibling = Math.min(safePage + safeSiblingCount, safeTotalPages);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < safeTotalPages - 1;

  if (!showLeftEllipsis && showRightEllipsis) {
    const leftItemCount = 3 + safeSiblingCount * 2;
    return [...range(1, leftItemCount), "ellipsis-end", safeTotalPages];
  }

  if (showLeftEllipsis && !showRightEllipsis) {
    const rightItemCount = 3 + safeSiblingCount * 2;
    return [1, "ellipsis-start", ...range(safeTotalPages - rightItemCount + 1, safeTotalPages)];
  }

  return [1, "ellipsis-start", ...range(leftSibling, rightSibling), "ellipsis-end", safeTotalPages];
};

export interface PaginationRange {
  from: number;
  to: number;
}

export const getPaginationRange = (
  page: number,
  pageSize: number,
  total: number,
): PaginationRange => {
  const safeTotal = Math.max(Math.trunc(total) || 0, 0);
  if (safeTotal === 0) {
    return { from: 0, to: 0 };
  }

  const safePageSize = Math.max(Math.trunc(pageSize) || 1, 1);
  const totalPages = Math.ceil(safeTotal / safePageSize);
  const safePage = clampPaginationPage(page, totalPages);

  return {
    from: (safePage - 1) * safePageSize + 1,
    to: Math.min(safePage * safePageSize, safeTotal),
  };
};
