/**
 * Time utility functions
 */

function formatHourMinute(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatAbsoluteDateTime(date: Date, now: Date, locale: string): string {
  const includeYear = date.getFullYear() !== now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    year: includeYear ? "numeric" : undefined,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Format a date to relative time string
 * Best-practice chat style:
 * - Today: localized "today HH:mm"
 * - Yesterday: localized "yesterday HH:mm"
 * - Within 7 days: localized "N days ago HH:mm"
 * - Older: specific date + time
 *
 * @param date - Date object or ISO date string
 * @param locale - BCP 47 locale tag. Pass the app's i18n locale (e.g. from
 *   `useI18nContext().locale`) so output honors the user's in-app language
 *   preference instead of the system/browser locale. Defaults to the system
 *   locale when omitted.
 * @returns Formatted relative time string
 * @throws Error if date is invalid
 */
export function formatRelativeTime(date: Date | string, locale?: string): string {
  const now = new Date();
  const targetDate = typeof date === "string" ? new Date(date) : date;
  const resolvedLocale = locale || Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  const rtf = new Intl.RelativeTimeFormat(resolvedLocale, { numeric: "auto" });

  // Validate date
  if (Number.isNaN(targetDate.getTime())) {
    throw new Error("Invalid date provided to formatRelativeTime");
  }

  const diffMs = now.getTime() - targetDate.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  // Handle future dates - treat as "now"
  if (diffMs < 0) {
    return rtf.format(0, "second");
  }

  if (diffMinutes < 1) {
    return rtf.format(0, "second");
  }

  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
  );
  const dayDiff = Math.floor((nowStart.getTime() - targetStart.getTime()) / 86_400_000);
  const timePart = formatHourMinute(targetDate, resolvedLocale);

  if (dayDiff === 0) {
    return `${rtf.format(0, "day")} ${timePart}`;
  }

  if (dayDiff === 1) {
    return `${rtf.format(-1, "day")} ${timePart}`;
  }

  if (dayDiff < 7) {
    return `${rtf.format(-dayDiff, "day")} ${timePart}`;
  }

  return formatAbsoluteDateTime(targetDate, now, resolvedLocale);
}
