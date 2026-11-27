export interface CalendarMonth {
  year: number;
  month: number;
}

/** A month belongs to one saved view; carrying its URL to another view must not move that view. */
export const readCalendarMonth = (search: string, scope: string): CalendarMonth | null => {
  const params = new URLSearchParams(search);
  if (params.get("calendarScope") !== scope) return null;
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(params.get("calendarMonth") ?? "");
  if (!match || Number(match[1]) < 1) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
};

export const writeCalendarMonth = (search: string, month: CalendarMonth, scope: string): string => {
  const params = new URLSearchParams(search);
  params.set(
    "calendarMonth",
    `${String(month.year).padStart(4, "0")}-${String(month.month + 1).padStart(2, "0")}`,
  );
  params.set("calendarScope", scope);
  return params.toString();
};
