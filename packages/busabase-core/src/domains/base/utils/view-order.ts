/**
 * Shared tab order of a Base's views: `position` ascending, ties broken by
 * creation time and then id so the order is total and stable. Pure and
 * isomorphic — used by listing, reorder merges, seed and the demo store.
 */
export interface OrderableView {
  id: string;
  position: number;
  createdAt: Date | string;
}

const toTime = (value: Date | string) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

export const compareViewOrder = (left: OrderableView, right: OrderableView): number =>
  left.position - right.position ||
  toTime(left.createdAt) - toTime(right.createdAt) ||
  (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const sortViewsByOrder = <T extends OrderableView>(views: readonly T[]): T[] =>
  [...views].sort(compareViewOrder);
