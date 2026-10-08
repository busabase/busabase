import type { BaseFieldVO } from "busabase-contract/types";
import {
  fromDateTimeInputValue,
  getDateFieldOptions,
  parseDateFieldValue,
  toDateTimeInputValue,
} from "../../base/utils/date-value";

/** Move the calendar's selected date field while keeping its displayed time of day. */
export const rescheduledCalendarValue = (
  field: BaseFieldVO,
  previous: unknown,
  targetDay: string,
): string | null => {
  if (
    field.type !== "date" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(targetDay) ||
    parseDateFieldValue(targetDay)?.kind !== "day"
  )
    return null;
  const options = getDateFieldOptions(field.options);
  if (!options.includeTime) return targetDay;
  const zone = options.timezone || undefined;
  const time = toDateTimeInputValue(previous, zone).slice(11);
  if (!time) return null;
  return fromDateTimeInputValue(`${targetDay}T${time}`, zone);
};
