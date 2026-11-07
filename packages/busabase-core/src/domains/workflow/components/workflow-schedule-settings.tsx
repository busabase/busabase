"use client";

import {
  type WorkflowSchedule,
  WorkflowScheduleSchema,
} from "busabase-contract/domains/rich-node/types";
import { WORKFLOW_SCHEDULE_MIN_MINUTES } from "busabase-contract/domains/workflow/run";
import { Input } from "kui/input";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { localTimeZone, nextScheduledRun } from "../utils/schedule";

interface Props {
  value: WorkflowSchedule | null;
  /** Whether the workflow is in Event mode; a schedule does nothing otherwise. */
  armed: boolean;
  onChange: (schedule: WorkflowSchedule) => void;
}

/** When a `schedule` trigger starts runs, with the next one spelled out. */
export function WorkflowScheduleSettings({ value, armed, onChange }: Props) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  // The editor fills in a schedule when the trigger becomes one. A graph saved
  // without it (by the API) runs on the schema default, so show exactly that.
  const schedule = value ?? WorkflowScheduleSchema.parse({});
  // Every edit records the editor's own zone, so "09:00" means 09:00 where they are.
  const update = (patch: Partial<WorkflowSchedule>) =>
    onChange({ ...schedule, timezone: localTimeZone(), ...patch });
  const weekdays = Array.from({ length: 7 }, (_, day) =>
    // 2026-11-01 is a Sunday: day 0.
    new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 10, 1 + day)),
    ),
  );
  const next = nextScheduledRun(schedule, new Date());
  const repeatsByCount = schedule.unit === "minutes" || schedule.unit === "hours";

  return (
    <div className="grid gap-3" data-workflow-schedule="">
      <label className="grid gap-1.5 text-muted-foreground text-xs" htmlFor="rich-node-schedule">
        {messages.richNodes.scheduleRepeat}
        <select
          className="h-9 border border-input bg-card px-3 text-foreground text-sm"
          data-workflow-schedule-unit=""
          id="rich-node-schedule"
          onChange={(event) => {
            const unit = event.target.value as WorkflowSchedule["unit"];
            update({
              unit,
              every:
                unit === "minutes"
                  ? Math.max(schedule.every, WORKFLOW_SCHEDULE_MIN_MINUTES)
                  : schedule.every,
            });
          }}
          value={schedule.unit}
        >
          <option value="minutes">{messages.richNodes.scheduleEveryMinutes}</option>
          <option value="hours">{messages.richNodes.scheduleEveryHours}</option>
          <option value="days">{messages.richNodes.scheduleDaily}</option>
          <option value="weeks">{messages.richNodes.scheduleWeekly}</option>
        </select>
      </label>
      {repeatsByCount ? (
        <label
          className="grid gap-1.5 text-muted-foreground text-xs"
          htmlFor="rich-node-schedule-every"
        >
          {schedule.unit === "minutes"
            ? fmt(messages.richNodes.scheduleMinutesBetween, {
                min: WORKFLOW_SCHEDULE_MIN_MINUTES,
              })
            : messages.richNodes.scheduleHoursBetween}
          <Input
            data-workflow-schedule-every=""
            id="rich-node-schedule-every"
            min={schedule.unit === "minutes" ? WORKFLOW_SCHEDULE_MIN_MINUTES : 1}
            onChange={(event) => {
              const every = Math.trunc(Number(event.target.value));
              if (Number.isFinite(every) && every >= 1 && every <= 1000) update({ every });
            }}
            type="number"
            value={schedule.every}
          />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {schedule.unit === "weeks" ? (
            <label
              className="grid gap-1.5 text-muted-foreground text-xs"
              htmlFor="rich-node-schedule-weekday"
            >
              {messages.richNodes.scheduleWeekday}
              <select
                className="h-9 border border-input bg-card px-3 text-foreground text-sm"
                data-workflow-schedule-weekday=""
                id="rich-node-schedule-weekday"
                onChange={(event) => update({ weekday: Number(event.target.value) })}
                value={schedule.weekday}
              >
                {weekdays.map((name, day) => (
                  <option key={name} value={day}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label
            className="grid gap-1.5 text-muted-foreground text-xs"
            htmlFor="rich-node-schedule-at"
          >
            {messages.richNodes.scheduleAt}
            <Input
              data-workflow-schedule-at=""
              id="rich-node-schedule-at"
              onChange={(event) => {
                if (/^([01]\d|2[0-3]):[0-5]\d$/.test(event.target.value)) {
                  update({ at: event.target.value });
                }
              }}
              type="time"
              value={schedule.at}
            />
          </label>
        </div>
      )}
      <p className="text-[11px] leading-snug text-muted-foreground/80">
        {repeatsByCount ? null : (
          <>{fmt(messages.richNodes.scheduleTimezone, { timezone: schedule.timezone })} </>
        )}
        <span data-workflow-schedule-next="">
          {fmt(messages.richNodes.scheduleNextRun, {
            time: new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(next),
          })}
        </span>
      </p>
      {armed ? null : (
        <p className="text-[11px] leading-snug text-warning" data-workflow-schedule-unarmed="">
          {messages.richNodes.scheduleNeedsEvent}
        </p>
      )}
    </div>
  );
}
