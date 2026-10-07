import {
  type DateFieldOptions,
  fromDateTimeInputValue,
  normalizeDateFieldText,
  toDateInputValue,
  toDateTimeInputValue,
} from "busabase-core/base/date-value";

/**
 * The text a mobile date field's TextInput holds. There is no native picker, so
 * the user types: `YYYY-MM-DD` for a day field, `YYYY-MM-DD HH:mm` (wall-clock
 * time in the field's zone, else the device's) for an `includeTime` field.
 */
export const dateFieldPlaceholder = (options: DateFieldOptions) =>
  options.includeTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD";

/** Stored value → input text. Unparseable stored text is kept so it isn't silently erased. */
export const toDateFieldInputText = (value: unknown, options: DateFieldOptions): string => {
  const text = options.includeTime
    ? toDateTimeInputValue(value, options.timezone).replace("T", " ")
    : toDateInputValue(value, options.timezone);
  if (text) return text;
  return typeof value === "string" ? value : "";
};

/**
 * Input text → stored value. Empty stays `""` (the form's existing "unset");
 * text that cannot be read as a date is returned as typed so the server's field
 * validator reports it rather than the edit vanishing.
 */
export const fromDateFieldInputText = (text: string, options: DateFieldOptions): string => {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (options.includeTime) {
    const instant = fromDateTimeInputValue(trimmed.replace(/\s+/, "T"), options.timezone);
    if (instant) return instant;
    // A bare day ("2026-10-02") is still a valid value for a date-time field.
    return normalizeDateFieldText(trimmed) ?? trimmed;
  }
  const normalized = normalizeDateFieldText(trimmed);
  // A day field stores a calendar day; text with a clock time collapses to its day.
  return normalized ? toDateInputValue(normalized, options.timezone) : trimmed;
};
