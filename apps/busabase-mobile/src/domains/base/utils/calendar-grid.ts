import { type DateFieldOptions, getDateFieldDayKey } from "busabase-core/base/date-value";

/** Local YYYY-MM-DD key for a Date — avoids the UTC off-by-one `toISOString()` would give. */
export const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * The grid cell a record's date value belongs in. A day value ("2026-10-02", or
 * the legacy UTC-midnight ISO form) is that day for every reader — it is never
 * parsed as an instant and shifted into the device's zone. A date-time value is
 * read in the field's pinned `timezone`, else the device's.
 */
export const recordDayKey = (value: unknown, options?: DateFieldOptions | null): string | null =>
  getDateFieldDayKey(value, options);

export interface MonthGrid {
  /** The Sunday on/before the 1st of the month, local time. */
  gridStart: Date;
  /** The day AFTER the grid's last cell — `[gridStart, gridEnd)` is exactly the 42 rendered days. */
  gridEnd: Date;
  days: Date[];
}

/** A 6-week (42-day) grid starting on the Sunday on/before the 1st of `year`/`month`. */
export const buildMonthGrid = (year: number, month: number): MonthGrid => {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay());
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 42);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return { gridStart, gridEnd, days };
};

export const shiftMonth = (
  cursor: { year: number; month: number },
  delta: 1 | -1,
): { year: number; month: number } => {
  if (delta === -1) {
    return cursor.month === 0
      ? { year: cursor.year - 1, month: 11 }
      : { year: cursor.year, month: cursor.month - 1 };
  }
  return cursor.month === 11
    ? { year: cursor.year + 1, month: 0 }
    : { year: cursor.year, month: cursor.month + 1 };
};
