import { describe, expect, it } from "vitest";
import { nextScheduledRun } from "./schedule";

const schedule = (patch: Partial<Parameters<typeof nextScheduledRun>[0]>) => ({
  unit: "days" as const,
  every: 1,
  at: "09:00",
  weekday: 1,
  timezone: "UTC",
  ...patch,
});
const at = (iso: string) => new Date(iso);

describe("nextScheduledRun", () => {
  it("repeats minutes on a grid, never closer than 15 minutes", () => {
    expect(
      nextScheduledRun(schedule({ unit: "minutes", every: 15 }), at("2026-11-03T04:07:00Z")),
    ).toEqual(at("2026-11-03T04:15:00Z"));
    // Exactly on a slot: the next one, not the same moment again.
    expect(
      nextScheduledRun(schedule({ unit: "minutes", every: 15 }), at("2026-11-03T04:15:00Z")),
    ).toEqual(at("2026-11-03T04:30:00Z"));
    expect(
      nextScheduledRun(schedule({ unit: "minutes", every: 1 }), at("2026-11-03T04:07:00Z")),
    ).toEqual(at("2026-11-03T04:15:00Z"));
  });

  it("repeats hours on the hour", () => {
    expect(
      nextScheduledRun(schedule({ unit: "hours", every: 1 }), at("2026-11-03T04:07:00Z")),
    ).toEqual(at("2026-11-03T05:00:00Z"));
    expect(
      nextScheduledRun(schedule({ unit: "hours", every: 6 }), at("2026-11-03T04:07:00Z")),
    ).toEqual(at("2026-11-03T06:00:00Z"));
  });

  it("runs daily at a local time, later today or tomorrow", () => {
    const daily = schedule({ unit: "days", at: "09:00", timezone: "Asia/Shanghai" });
    // 08:00 in Shanghai: later today at 09:00 (01:00 UTC).
    expect(nextScheduledRun(daily, at("2026-11-03T00:00:00Z"))).toEqual(at("2026-11-03T01:00:00Z"));
    // 12:00 in Shanghai: tomorrow.
    expect(nextScheduledRun(daily, at("2026-11-03T04:00:00Z"))).toEqual(at("2026-11-04T01:00:00Z"));
    // Exactly 09:00: tomorrow, so a tick at the due moment does not repeat it.
    expect(nextScheduledRun(daily, at("2026-11-03T01:00:00Z"))).toEqual(at("2026-11-04T01:00:00Z"));
  });

  it("runs weekly on the chosen weekday", () => {
    // Monday 09:00 UTC; 2026-11-03 is a Tuesday.
    const weekly = schedule({ unit: "weeks", weekday: 1, at: "09:00" });
    expect(nextScheduledRun(weekly, at("2026-11-03T10:00:00Z"))).toEqual(
      at("2026-11-09T09:00:00Z"),
    );
    // Monday before 09:00: the same day.
    expect(nextScheduledRun(weekly, at("2026-11-09T08:59:00Z"))).toEqual(
      at("2026-11-09T09:00:00Z"),
    );
    // Monday after 09:00: the next Monday.
    expect(nextScheduledRun(weekly, at("2026-11-09T09:00:00Z"))).toEqual(
      at("2026-11-16T09:00:00Z"),
    );
  });

  it("keeps the local time across a daylight-saving change", () => {
    const daily = schedule({ unit: "days", at: "09:00", timezone: "America/New_York" });
    // New York leaves daylight saving on 2026-11-01: 09:00 is 13:00 UTC before, 14:00 after.
    expect(nextScheduledRun(daily, at("2026-10-31T12:00:00Z"))).toEqual(at("2026-10-31T13:00:00Z"));
    expect(nextScheduledRun(daily, at("2026-10-31T14:00:00Z"))).toEqual(at("2026-11-01T14:00:00Z"));
  });

  it("runs a time skipped by spring-forward just after the jump, on that same day", () => {
    // New York, 2026-03-08: 02:00 EST jumps to 03:00 EDT, so 02:30 never happens.
    const daily = schedule({ unit: "days", at: "02:30", timezone: "America/New_York" });
    // 00:00 and 01:45 local: today at 03:30 EDT (07:30 UTC), never before the jump.
    expect(nextScheduledRun(daily, at("2026-03-08T05:00:00Z"))).toEqual(at("2026-03-08T07:30:00Z"));
    expect(nextScheduledRun(daily, at("2026-03-08T06:45:00Z"))).toEqual(at("2026-03-08T07:30:00Z"));
    // After it ran: an ordinary 02:30 EDT the next day.
    expect(nextScheduledRun(daily, at("2026-03-08T07:30:00Z"))).toEqual(at("2026-03-09T06:30:00Z"));
  });

  it("runs a time repeated by fall-back once, at its first occurrence", () => {
    // New York, 2026-11-01: 01:00–02:00 happens twice, first in EDT, then in EST.
    const daily = schedule({ unit: "days", at: "01:30", timezone: "America/New_York" });
    expect(nextScheduledRun(daily, at("2026-11-01T04:00:00Z"))).toEqual(at("2026-11-01T05:30:00Z"));
    // Between the two 01:30s: not a second time today.
    expect(nextScheduledRun(daily, at("2026-11-01T05:30:00Z"))).toEqual(at("2026-11-02T06:30:00Z"));
  });

  it("applies the same rules to a weekly schedule on a change day", () => {
    // Sunday 02:30 in New York on the spring-forward Sunday.
    const weekly = schedule({
      unit: "weeks",
      weekday: 0,
      at: "02:30",
      timezone: "America/New_York",
    });
    expect(nextScheduledRun(weekly, at("2026-03-08T05:00:00Z"))).toEqual(
      at("2026-03-08T07:30:00Z"),
    );
  });

  it("runs exactly once per local day through every 2026 clock change, at any time of day", () => {
    const localDate = (instant: Date, timeZone: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(instant);
    const zones = [
      // Northern and southern hemisphere, a 30-minute change, and a zone without one.
      { timeZone: "America/New_York", changes: ["2026-03-07T12:00:00Z", "2026-10-31T12:00:00Z"] },
      { timeZone: "Europe/London", changes: ["2026-03-28T12:00:00Z", "2026-10-24T12:00:00Z"] },
      { timeZone: "Australia/Sydney", changes: ["2026-04-04T00:00:00Z", "2026-10-03T00:00:00Z"] },
      {
        timeZone: "Australia/Lord_Howe",
        changes: ["2026-04-04T00:00:00Z", "2026-10-03T00:00:00Z"],
      },
      { timeZone: "Asia/Shanghai", changes: ["2026-03-07T12:00:00Z"] },
    ];
    for (const { timeZone, changes } of zones) {
      for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
        const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
        const daily = schedule({ unit: "days", at: time, timezone: timeZone });
        for (const start of changes) {
          const days: string[] = [];
          const localTime = (instant: Date) =>
            new Intl.DateTimeFormat("en-GB", {
              timeZone,
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            }).format(instant);
          let cursor = at(start);
          for (let run = 0; run < 4; run += 1) {
            cursor = nextScheduledRun(daily, cursor);
            days.push(localDate(cursor, timeZone));
            // Never earlier than the chosen time; later only when a jump skipped it.
            expect(
              localTime(cursor) >= time,
              `${timeZone} ${time}: ran at ${localTime(cursor)}`,
            ).toBe(true);
          }
          const label = `${timeZone} ${time} from ${start}`;
          expect(new Set(days).size, `${label}: ran twice on a day ${days}`).toBe(4);
          // Consecutive local days, none skipped.
          const first = Date.parse(`${days[0]}T00:00:00Z`);
          expect(
            days.map((day) => (Date.parse(`${day}T00:00:00Z`) - first) / 86_400_000),
            `${label}: skipped a day ${days}`,
          ).toEqual([0, 1, 2, 3]);
        }
      }
    }
  });

  it("falls back to UTC for an unknown time zone", () => {
    const daily = schedule({ unit: "days", at: "09:00", timezone: "Mars/Olympus" });
    expect(nextScheduledRun(daily, at("2026-11-03T04:00:00Z"))).toEqual(at("2026-11-03T09:00:00Z"));
  });
});
