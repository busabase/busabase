import type { WorkflowSchedule } from "busabase-contract/domains/rich-node/types";
import { WORKFLOW_SCHEDULE_MIN_MINUTES } from "busabase-contract/domains/workflow/run";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The time zone of whoever is editing, for a schedule they create. */
export const localTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** Whether `timeZone` is one this runtime can format in. */
export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** Local wall-clock parts of `date` in `timeZone`. */
const wallClock = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
};

/** How far `timeZone` is ahead of UTC at `date`, in milliseconds. */
const zoneOffset = (date: Date, timeZone: string): number => {
  const local = wallClock(date, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

const DAY = 24 * HOUR;

/**
 * The instant a wall-clock time happens in `timeZone`, by the rule calendars
 * use (RFC 5545):
 *
 * - a time repeated when clocks go back happens at its first occurrence;
 * - a time skipped when clocks go forward is read with the offset from before
 *   the jump, so 02:30 on a 02:00→03:00 night lands at 03:30, the same day.
 *
 * The two candidate offsets are the zone's offset a day either side; real
 * zones never change twice within that span.
 */
const instantOf = (
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string,
): Date => {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const before = zoneOffset(new Date(wall - DAY), timeZone);
  const after = zoneOffset(new Date(wall + DAY), timeZone);
  const shows = (instant: number) => wall - zoneOffset(new Date(instant), timeZone) === instant;
  const matches = [wall - before, wall - after].filter(shows);
  if (matches.length > 0) return new Date(Math.min(...matches));
  return new Date(wall - before);
};

/**
 * The first moment strictly after `after` that `schedule` starts a run.
 *
 * Minutes and hours repeat on a grid counted from the Unix epoch in UTC, so
 * every replica and every restart agrees on the next slot without keeping
 * state. Days and weeks run at `at` in the schedule's time zone (UTC if the
 * zone is unknown).
 */
export const nextScheduledRun = (schedule: WorkflowSchedule, after: Date): Date => {
  if (schedule.unit === "minutes" || schedule.unit === "hours") {
    const step =
      schedule.unit === "minutes"
        ? Math.max(schedule.every, WORKFLOW_SCHEDULE_MIN_MINUTES) * MINUTE
        : Math.max(schedule.every, 1) * HOUR;
    return new Date((Math.floor(after.getTime() / step) + 1) * step);
  }
  const timeZone = isValidTimeZone(schedule.timezone) ? schedule.timezone : "UTC";
  const [hour, minute] = schedule.at.split(":").map(Number);
  const today = wallClock(after, timeZone);
  // Eight days covers "later today" through "same weekday next week".
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (schedule.unit === "weeks" && day.getUTCDay() !== schedule.weekday) continue;
    const candidate = instantOf(
      { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() },
      hour ?? 0,
      minute ?? 0,
      timeZone,
    );
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  // Unreachable for a valid schedule; never return a time in the past.
  return new Date(after.getTime() + 24 * HOUR);
};
