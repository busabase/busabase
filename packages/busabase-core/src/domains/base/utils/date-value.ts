/**
 * How a `date` field value is read, shown and written — one place, shared by
 * the dashboard, the server-side view evaluator and the mobile app.
 *
 * A `date` field holds one of two kinds of value, and they mean different things:
 *
 * - **A calendar day** — `"2026-10-02"` (what the date picker writes), or the
 *   UTC-midnight ISO form `"2026-10-02T00:00:00.000Z"` that CSV import and type
 *   conversion used to write. It names a day on the calendar, not a moment, so it
 *   is NEVER shifted into the reader's timezone: everyone sees October 2. Parsing
 *   it with `new Date()` and reading local components is the bug this module
 *   exists to prevent — anyone west of UTC saw October 1.
 * - **An instant** — any other ISO timestamp, e.g. `"2026-10-02T18:00:00+08:00"`.
 *   Fields with `options.date.includeTime` write these, keeping the writer's UTC
 *   offset so a reader can be told what the writer actually typed. An instant is
 *   shown in the field's fixed `timezone`, or in each reader's own timezone.
 *
 * Pure and isomorphic: no React, no db, only `Intl`.
 */

export interface DateFieldOptions {
  /** Record a time of day as well as the date. */
  includeTime?: boolean;
  /**
   * IANA zone every reader sees the time in (e.g. `"Asia/Shanghai"`). Absent =
   * each reader sees their own local time. Only meaningful with `includeTime`.
   */
  timezone?: string;
}

export interface CalendarDay {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

export type ParsedDateFieldValue =
  | { kind: "day"; day: CalendarDay }
  | {
      kind: "instant";
      date: Date;
      /** The UTC offset the value was written with, in minutes; null if unknown. */
      offsetMinutes: number | null;
    };

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// The UTC-midnight form older import/convert paths wrote for a plain day.
const UTC_MIDNIGHT = /^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.0+)?)?Z$/;
const OFFSET_SUFFIX = /(?:([+-])(\d{2}):?(\d{2})|Z)$/;
// The ISO date/time separator — a digit on each side, so the capital T of
// "Tue" / "Thu" in loose text ("Tue, Oct 6, 2026") is not mistaken for it.
const ISO_TIME_SEPARATOR = /\dT\d/;

const isRealDay = (year: number, month: number, day: number) => {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    year > 0 &&
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
};

export const parseDateFieldValue = (value: unknown): ParsedDateFieldValue | null => {
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : { kind: "instant", date, offsetMinutes: null };
  }
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  const dayMatch = DAY_ONLY.exec(text) ?? UTC_MIDNIGHT.exec(text);
  if (dayMatch) {
    const [year, month, day] = [Number(dayMatch[1]), Number(dayMatch[2]), Number(dayMatch[3])];
    return isRealDay(year, month, day) ? { kind: "day", day: { year, month, day } } : null;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  // Loose text with no clock time ("10/2/2026", "2026-9-1", "Oct 2, 2026") also
  // names a day. The runtime parsed it as local midnight, so read it back in
  // local time — the digits the user typed, whatever zone this runs in.
  const hasIsoTime = ISO_TIME_SEPARATOR.test(text);
  if (!/\d:\d/.test(text) && !hasIsoTime) {
    return date.getFullYear() > 0 ? { kind: "day", day: localDateToCalendarDay(date) } : null;
  }
  const offset = hasIsoTime ? OFFSET_SUFFIX.exec(text) : null;
  let offsetMinutes: number | null = null;
  if (offset) {
    offsetMinutes = offset[1]
      ? (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]))
      : 0;
  }
  return { kind: "instant", date, offsetMinutes };
};

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, "0");

export const formatDayKey = ({ year, month, day }: CalendarDay) =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

const dayToUtcDate = ({ year, month, day }: CalendarDay) =>
  new Date(Date.UTC(year, month - 1, day));

const timeZoneValidity = new Map<string, boolean>();

/** True for a zone `Intl` can use. Unknown zones fall back to the reader's local time. */
export const isValidTimeZone = (timeZone: string | null | undefined): timeZone is string => {
  if (!timeZone) return false;
  const cached = timeZoneValidity.get(timeZone);
  if (cached !== undefined) return cached;
  let valid = true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    valid = false;
  }
  timeZoneValidity.set(timeZone, valid);
  return valid;
};

const usableZone = (timeZone: string | null | undefined) =>
  isValidTimeZone(timeZone) ? timeZone : undefined;

/** The UTC offset (minutes) of `timeZone` at `instant`; undefined zone = this runtime's. */
export const getTimeZoneOffsetMinutes = (instant: Date, timeZone?: string): number => {
  const zone = usableZone(timeZone);
  if (!zone) {
    return -instant.getTimezoneOffset();
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((wallAsUtc - wholeSeconds) / 60_000);
};

/** The calendar day an instant falls on in `timeZone` (undefined = this runtime's). */
export const calendarDayInZone = (instant: Date, timeZone?: string): CalendarDay => {
  const shifted = new Date(
    instant.getTime() + getTimeZoneOffsetMinutes(instant, timeZone) * 60_000,
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

/**
 * The calendar day a value belongs on — for calendar cells, Gantt bars and
 * day-level comparisons. A day value is itself; an instant is read in the
 * display zone (`options.timezone`, else the reader's local time).
 */
export const getDateFieldCalendarDay = (
  value: unknown,
  options?: DateFieldOptions | null,
  readerTimeZone?: string,
): CalendarDay | null => {
  const parsed = parseDateFieldValue(value);
  if (!parsed) return null;
  if (parsed.kind === "day") return parsed.day;
  return calendarDayInZone(parsed.date, usableZone(options?.timezone) ?? readerTimeZone);
};

export const getDateFieldDayKey = (
  value: unknown,
  options?: DateFieldOptions | null,
  readerTimeZone?: string,
): string | null => {
  const day = getDateFieldCalendarDay(value, options, readerTimeZone);
  return day ? formatDayKey(day) : null;
};

/** A local `Date` at midnight of that calendar day — for grids built in local time. */
export const calendarDayToLocalDate = ({ year, month, day }: CalendarDay) =>
  new Date(year, month - 1, day);

export const localDateToCalendarDay = (date: Date): CalendarDay => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
});

/**
 * Days between the day the writer saw and the day the reader sees: `+1` when
 * the reader's clock is already on the next day, `-1` when still on the
 * previous one, `0` when they agree or the writer's offset is unknown.
 */
const dayShift = (instant: Date, writerOffset: number | null, displayZone?: string): number => {
  if (writerOffset === null) return 0;
  const writerDay = dayToUtcDate(
    (() => {
      const shifted = new Date(instant.getTime() + writerOffset * 60_000);
      return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
      };
    })(),
  );
  const readerDay = dayToUtcDate(calendarDayInZone(instant, displayZone));
  return Math.round((readerDay.getTime() - writerDay.getTime()) / 86_400_000);
};

const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  ...DAY_FORMAT,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

export const formatCalendarDay = (day: CalendarDay, locale?: Intl.LocalesArgument) =>
  new Intl.DateTimeFormat(locale, { ...DAY_FORMAT, timeZone: "UTC" }).format(dayToUtcDate(day));

const formatInstant = (instant: Date, locale: Intl.LocalesArgument, timeZone?: string) =>
  new Intl.DateTimeFormat(locale, { ...TIME_FORMAT, timeZone }).format(instant);

const formatOffset = (minutes: number) =>
  minutes === 0
    ? "UTC"
    : `UTC${minutes > 0 ? "+" : "-"}${pad(Math.trunc(minutes / 60))}:${pad(minutes % 60)}`;

export interface DateFieldDisplay {
  /** What the cell shows. */
  text: string;
  /** Day shift vs. what the writer typed (see `dayShift`); 0 for day values. */
  dayShift: number;
  /** The same moment as the writer entered it, when it differs from `text`. */
  enteredAs: string | null;
  /** The same moment in the reader's own zone, when the field pins another zone. */
  readerLocal: string | null;
}

/**
 * Everything a cell needs to show a date value. `readerTimeZone` is only for
 * tests and servers; in a browser leave it undefined (= the reader's zone).
 */
export const describeDateFieldValue = (
  value: unknown,
  {
    locale,
    options,
    readerTimeZone,
  }: {
    locale?: Intl.LocalesArgument;
    options?: DateFieldOptions | null;
    readerTimeZone?: string;
  } = {},
): DateFieldDisplay | null => {
  const parsed = parseDateFieldValue(value);
  if (!parsed) return null;
  if (parsed.kind === "day") {
    return {
      text: formatCalendarDay(parsed.day, locale),
      dayShift: 0,
      enteredAs: null,
      readerLocal: null,
    };
  }
  const fieldZone = usableZone(options?.timezone);
  const displayZone = fieldZone ?? readerTimeZone;
  if (!options?.includeTime) {
    return {
      text: formatCalendarDay(calendarDayInZone(parsed.date, displayZone), locale),
      dayShift: 0,
      enteredAs: null,
      readerLocal: null,
    };
  }
  const text = formatInstant(parsed.date, locale, displayZone);
  const displayOffset = getTimeZoneOffsetMinutes(parsed.date, displayZone);
  return {
    text,
    dayShift: dayShift(parsed.date, parsed.offsetMinutes, displayZone),
    enteredAs:
      parsed.offsetMinutes !== null && parsed.offsetMinutes !== displayOffset
        ? formatWallTimeAtOffset(parsed.date, parsed.offsetMinutes, locale)
        : null,
    readerLocal:
      fieldZone && getTimeZoneOffsetMinutes(parsed.date, readerTimeZone) !== displayOffset
        ? formatInstant(parsed.date, locale, readerTimeZone)
        : null,
  };
};

// `Intl` cannot format in a bare offset, so shift the instant and format as UTC.
const formatWallTimeAtOffset = (
  instant: Date,
  offsetMinutes: number,
  locale: Intl.LocalesArgument,
) => {
  const shifted = new Date(instant.getTime() + offsetMinutes * 60_000);
  const { timeZoneName: _omit, ...withoutZone } = TIME_FORMAT;
  return `${new Intl.DateTimeFormat(locale, { ...withoutZone, timeZone: "UTC" }).format(shifted)} (${formatOffset(offsetMinutes)})`;
};

/** Just the text — for places that only have room for a string. */
export const formatDateFieldValue = (
  value: unknown,
  params?: Parameters<typeof describeDateFieldValue>[1],
): string | null => describeDateFieldValue(value, params)?.text ?? null;

/**
 * A stable, sortable, locale-free key for filters and sorts that must give the
 * same answer on every server and browser: `YYYY-MM-DD` for a day, and
 * `YYYY-MM-DD HH:mm` for an instant (read in the field's zone, else UTC — a
 * server has no reader). Day keys sort chronologically, unlike display text.
 */
export const getDateFieldSortKey = (value: unknown, options?: DateFieldOptions | null): string => {
  const parsed = parseDateFieldValue(value);
  if (!parsed) {
    return typeof value === "string" ? value : "";
  }
  if (parsed.kind === "day") {
    return formatDayKey(parsed.day);
  }
  const zone = usableZone(options?.timezone) ?? "UTC";
  const shifted = new Date(
    parsed.date.getTime() + getTimeZoneOffsetMinutes(parsed.date, zone) * 60_000,
  );
  const key = `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return options?.includeTime
    ? `${key} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
    : key;
};

/**
 * The value a `<input type="datetime-local">` shows (`YYYY-MM-DDTHH:mm`), read
 * in `timeZone` (undefined = the reader's). A day value opens at 00:00.
 */
export const toDateTimeInputValue = (value: unknown, timeZone?: string): string => {
  const parsed = parseDateFieldValue(value);
  if (!parsed) return "";
  if (parsed.kind === "day") return `${formatDayKey(parsed.day)}T00:00`;
  const zone = usableZone(timeZone);
  const shifted = new Date(
    parsed.date.getTime() + getTimeZoneOffsetMinutes(parsed.date, zone) * 60_000,
  );
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
};

/** The value a `<input type="date">` shows (`YYYY-MM-DD`); instants read in `timeZone`. */
export const toDateInputValue = (value: unknown, timeZone?: string): string => {
  const parsed = parseDateFieldValue(value);
  if (!parsed) return "";
  return formatDayKey(
    parsed.kind === "day" ? parsed.day : calendarDayInZone(parsed.date, usableZone(timeZone)),
  );
};

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Turn what a `<input type="datetime-local">` holds — a wall-clock time in
 * `timeZone` (undefined = the reader's) — into the stored value: an ISO string
 * that keeps that zone's offset, e.g. `2026-10-02T18:00:00+08:00`.
 */
export const fromDateTimeInputValue = (input: string, timeZone?: string): string | null => {
  const match = WALL_TIME.exec(input.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (!isRealDay(year, month, day) || hour > 23 || minute > 59) return null;
  const zone = usableZone(timeZone);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset across a DST change.
  let offset = getTimeZoneOffsetMinutes(new Date(wallAsUtc), zone);
  offset = getTimeZoneOffsetMinutes(new Date(wallAsUtc - offset * 60_000), zone);
  const sign = offset < 0 ? "-" : "+";
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.trunc(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
};

/**
 * Normalize loosely-typed text (CSV import, paste, type conversion) into a
 * stored date value. Text that names only a day — `2026-10-02`, `10/2/2026`,
 * `Oct 2, 2026` — becomes `YYYY-MM-DD`, taken from the digits the user typed
 * rather than from wherever this code happens to run. Text with a real time
 * becomes an ISO instant.
 */
export const normalizeDateFieldText = (text: string): string | null => {
  const parsed = parseDateFieldValue(text);
  if (!parsed) return null;
  if (parsed.kind === "day") return formatDayKey(parsed.day);
  return parsed.date.getUTCFullYear() > 0 ? parsed.date.toISOString() : null;
};

/** Read `options.date` off a field's options bag, tolerating anything. */
export const getDateFieldOptions = (options: unknown): DateFieldOptions => {
  if (!options || typeof options !== "object") return {};
  const date = (options as { date?: unknown }).date;
  if (!date || typeof date !== "object") return {};
  const { includeTime, timezone } = date as { includeTime?: unknown; timezone?: unknown };
  return {
    includeTime: includeTime === true,
    ...(typeof timezone === "string" && timezone ? { timezone } : {}),
  };
};

/** Zones for a picker; empty when the runtime cannot list them. */
export const listTimeZones = (): string[] => {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
};

/** Short label for a zone at a moment, e.g. "GMT+8" — for the "you are typing in" hint. */
export const formatTimeZoneLabel = (
  timeZone: string | undefined,
  locale?: Intl.LocalesArgument,
  at: Date = new Date(),
): string => {
  const zone = usableZone(timeZone);
  const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "short" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  const resolved = zone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return name && name !== resolved ? `${resolved} (${name})` : resolved;
};

const DAY_MS = 86_400_000;

/**
 * The server-side `dateRange` for a grid of LOCAL days `[gridStart, gridEnd)`
 * (calendar month views on web and mobile).
 *
 * A `date` field's day values are stored at UTC midnight of the day they name,
 * not at the reader's local midnight, and an instant in it can land on either
 * side of a grid edge once read in the display zone — so its bounds are the
 * UTC midnights of the grid's local dates, widened by a day each way. Callers
 * place records by their own day key, and ones outside the grid don't render.
 * `created_time` / `updated_time` are real instants and keep the local bounds.
 */
export const getCalendarDateRange = (
  fieldType: string | null | undefined,
  gridStart: Date,
  gridEnd: Date,
): { gte: string; lt: string } => {
  if (fieldType !== "date") {
    return { gte: gridStart.toISOString(), lt: gridEnd.toISOString() };
  }
  const utcMidnight = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return {
    gte: new Date(utcMidnight(gridStart) - DAY_MS).toISOString(),
    lt: new Date(utcMidnight(gridEnd) + DAY_MS).toISOString(),
  };
};
