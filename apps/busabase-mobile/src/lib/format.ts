export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

// Short "Jul 11" form for dense list rows — mirrors formatListTime in
// packages/busabase-core/src/domains/dashboard/helpers/format.ts. Use
// formatDate above for detail screens where the full date/time is wanted.
export function formatListTime(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

/**
 * The activity feed's timestamp — the mobile twin of `formatListDateTime` in
 * packages/busabase-core/src/domains/dashboard/helpers/format.ts, and it has to
 * stay in step with it: an activity row is a log entry, so it keeps the clock
 * time down to the second, and it prints the year only when the event did not
 * happen in the current calendar year (the rule Gmail, X and `ls -l` share).
 *
 * Calendar year rather than "older than 365 days" is deliberate: a rolling
 * window prints a February 2026 event as a bare "Feb 10" when it is read in
 * January 2027, and every reader takes that for this year.
 *
 * `now` is injectable so the rule can be tested without waiting for New Year.
 */
export function formatListDateTime(value: string | null | undefined, now: Date = new Date()) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}
