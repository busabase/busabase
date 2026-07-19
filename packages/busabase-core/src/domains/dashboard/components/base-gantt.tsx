import type { BaseFieldVO, BaseVO, GanttScale, RecordVO, ViewVO } from "busabase-contract/types";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useCoreI18n } from "../../../i18n";
import { getRecordTitle } from "../helpers/change-request";
import { mergeSearchIntoHref } from "../helpers/link-search";

const DAY_MS = 86_400_000;
// Pixels per day per scale — month packs tighter, week spreads out.
const DAY_PX: Record<GanttScale, number> = { month: 5, week: 22 };
const TITLE_COL_PX = 200;

const dateFieldTypes = ["date", "created_time", "updated_time"] as const;

/** Resolve the start/end date fields. Honors config; else first two date fields. */
export const resolveGanttFields = (
  base: BaseVO | null,
  fields: BaseFieldVO[],
  startSlug: string | null | undefined,
  endSlug: string | null | undefined,
): { start: BaseFieldVO | null; end: BaseFieldVO | null } => {
  const dateFields = (base?.fields ?? fields).filter((f) =>
    (dateFieldTypes as readonly string[]).includes(f.type),
  );
  const start = startSlug
    ? (dateFields.find((f) => f.slug === startSlug) ?? null)
    : (dateFields[0] ?? null);
  const end = endSlug
    ? (dateFields.find((f) => f.slug === endSlug) ?? null)
    : (dateFields.find((f) => f.slug !== start?.slug) ?? null);
  return { start, end };
};

// Local-midnight Date from a YYYY-MM-DD or ISO value, or null.
const parseDay = (value: unknown): Date | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

type DragMode = "move" | "resize-start" | "resize-end";
type DragState = { recordId: string; mode: DragMode; originX: number; deltaDays: number };

type Row = { record: RecordVO; start: Date; end: Date };

export function BusaBaseGantt({
  activeView,
  base,
  fields,
  records,
  onPatchRecord,
}: {
  activeView: ViewVO | null;
  base: BaseVO | null;
  fields: BaseFieldVO[];
  records: RecordVO[];
  /** Reschedule: patch start/end on a record and auto-merge, no navigation. */
  onPatchRecord?: (record: RecordVO, patch: Record<string, unknown>) => Promise<void>;
}) {
  const messages = useCoreI18n();
  const currentSearch = useSearch();
  const [drag, setDrag] = useState<DragState | null>(null);
  // Seeds from the view's saved scale; the toolbar toggle overrides it locally.
  const [scale, setScale] = useState<GanttScale>(activeView?.config.ganttScale ?? "month");
  const dayPx = DAY_PX[scale];
  const { start: startField, end: endField } = resolveGanttFields(
    base,
    fields,
    activeView?.config.startFieldSlug,
    activeView?.config.endFieldSlug,
  );
  const baseSlug = base?.slug ?? records[0]?.base.slug ?? "";

  // Window listeners drive the active drag; committed on mouse-up.
  useEffect(() => {
    if (!drag) {
      return;
    }
    const onMove = (event: MouseEvent) => {
      setDrag((current) =>
        current
          ? { ...current, deltaDays: Math.round((event.clientX - current.originX) / dayPx) }
          : current,
      );
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, dayPx]);

  if (!startField || !endField) {
    return (
      <div className="px-2 py-6 text-muted-foreground text-sm">{messages.base.ganttNoDates}</div>
    );
  }

  const rows: Row[] = [];
  for (const record of records) {
    const start = parseDay(record.headCommit.fields[startField.slug]);
    const end = parseDay(record.headCommit.fields[endField.slug]);
    if (start && end && end.getTime() >= start.getTime()) {
      rows.push({ record, start, end });
    }
  }

  if (rows.length === 0) {
    return (
      <div className="px-2 py-6 text-muted-foreground text-sm">{messages.base.ganttNoDates}</div>
    );
  }

  // Axis range: pad to whole months around the data.
  const minStart = rows.reduce((m, r) => (r.start < m ? r.start : m), rows[0].start);
  const maxEnd = rows.reduce((m, r) => (r.end > m ? r.end : m), rows[0].end);
  const rangeStart = new Date(minStart.getFullYear(), minStart.getMonth(), 1);
  const rangeEnd = new Date(maxEnd.getFullYear(), maxEnd.getMonth() + 1, 0);
  const totalDays = daysBetween(rangeStart, rangeEnd) + 1;
  const timelineWidth = totalDays * dayPx;

  // Month header segments across the range.
  const months: Array<{ label: string; left: number; width: number }> = [];
  let cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const clippedEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd;
    months.push({
      label: monthStart.toLocaleDateString(undefined, { year: "numeric", month: "short" }),
      left: daysBetween(rangeStart, monthStart) * dayPx,
      width: (daysBetween(monthStart, clippedEnd) + 1) * dayPx,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  const canDrag = Boolean(onPatchRecord);

  // Apply the in-flight drag delta to a row for live preview.
  const previewDates = (row: Row): { start: Date; end: Date } => {
    if (!drag || drag.recordId !== row.record.id || drag.deltaDays === 0) {
      return { start: row.start, end: row.end };
    }
    if (drag.mode === "move") {
      return { start: addDays(row.start, drag.deltaDays), end: addDays(row.end, drag.deltaDays) };
    }
    if (drag.mode === "resize-start") {
      const next = addDays(row.start, drag.deltaDays);
      return { start: next > row.end ? row.end : next, end: row.end };
    }
    const next = addDays(row.end, drag.deltaDays);
    return { start: row.start, end: next < row.start ? row.start : next };
  };

  const commitDrag = (row: Row) => {
    if (!drag || drag.recordId !== row.record.id || drag.deltaDays === 0 || !onPatchRecord) {
      return;
    }
    const { start, end } = previewDates(row);
    const patch: Record<string, unknown> = {};
    if (start.getTime() !== row.start.getTime()) {
      patch[startField.slug] = toYMD(start);
    }
    if (end.getTime() !== row.end.getTime()) {
      patch[endField.slug] = toYMD(end);
    }
    if (Object.keys(patch).length > 0) {
      void onPatchRecord(row.record, { ...row.record.headCommit.fields, ...patch });
    }
  };

  const beginDrag = (event: React.MouseEvent, row: Row) => {
    if (!canDrag) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const edge = 8;
    const mode: DragMode =
      offsetX <= edge ? "resize-start" : offsetX >= rect.width - edge ? "resize-end" : "move";
    setDrag({ recordId: row.record.id, mode, originX: event.clientX, deltaDays: 0 });
  };

  return (
    <div className="overflow-x-auto pb-5">
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <span className="text-muted-foreground text-xs">{messages.base.ganttScale}</span>
        <div className="flex rounded-md bg-muted/60 p-0.5 text-xs">
          {(["week", "month"] as const).map((option) => (
            <button
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                scale === option
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              key={option}
              onClick={() => setScale(option)}
              type="button"
            >
              {option === "week" ? messages.base.ganttWeek : messages.base.ganttMonth}
            </button>
          ))}
        </div>
      </div>

      <div style={{ width: TITLE_COL_PX + timelineWidth }}>
        {/* Month axis header */}
        <div className="flex border-border/50 border-b">
          <div className="shrink-0 border-border/50 border-r" style={{ width: TITLE_COL_PX }} />
          <div className="relative" style={{ width: timelineWidth, height: 28 }}>
            {months.map((m) => (
              <div
                className="absolute top-0 truncate border-border/40 border-l px-1.5 py-1 text-muted-foreground text-xs"
                key={m.label}
                style={{ left: m.left, width: m.width }}
              >
                {m.label}
              </div>
            ))}
          </div>
        </div>

        {/* Rows */}
        {rows.map((row) => {
          const { start, end } = previewDates(row);
          const left = daysBetween(rangeStart, start) * dayPx;
          const width = Math.max((daysBetween(start, end) + 1) * dayPx, dayPx);
          const active = drag?.recordId === row.record.id;
          return (
            <div className="flex items-center border-border/30 border-b" key={row.record.id}>
              <div
                className="shrink-0 truncate border-border/50 border-r px-2 py-2"
                style={{ width: TITLE_COL_PX }}
              >
                <Link
                  className="truncate font-medium text-foreground text-sm hover:underline"
                  href={mergeSearchIntoHref(`/base/${baseSlug}/${row.record.id}`, currentSearch)}
                  title={getRecordTitle(row.record, messages)}
                >
                  {getRecordTitle(row.record, messages)}
                </Link>
              </div>
              <div className="relative py-1.5" style={{ width: timelineWidth, height: 32 }}>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: gantt bar is a mouse drag handle; the row title Link is the keyboard-accessible affordance */}
                <div
                  className={`absolute top-1.5 flex h-5 items-center rounded bg-primary/80 text-primary-foreground text-xs shadow-sm ${
                    canDrag ? "cursor-grab active:cursor-grabbing" : ""
                  } ${active ? "ring-2 ring-primary" : ""}`}
                  onMouseDown={canDrag ? (event) => beginDrag(event, row) : undefined}
                  onMouseUp={canDrag ? () => commitDrag(row) : undefined}
                  style={{ left, width }}
                  title={`${toYMD(start)} → ${toYMD(end)}`}
                >
                  <span className="truncate px-1.5">{getRecordTitle(row.record, messages)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
