import type { GanttScale } from "busabase-contract/types";

export interface TimelineState {
  scale: GanttScale;
  start: string;
}

/** URL state is local browsing context for one Base/view, never a saved view change. */
export const readTimelineState = (search: string, scope: string): TimelineState | null => {
  const params = new URLSearchParams(search);
  if (params.get("timelineScope") !== scope) return null;
  const scale = params.get("timelineScale");
  const start = params.get("timelineStart") ?? "";
  if (scale !== "week" && scale !== "month") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number(start.slice(0, 4)) < 1) return null;
  const date = new Date(`${start}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== start) return null;
  return { scale, start };
};

export const writeTimelineState = (search: string, value: TimelineState, scope: string): string => {
  const params = new URLSearchParams(search);
  params.set("timelineScale", value.scale);
  params.set("timelineStart", value.start);
  params.set("timelineScope", scope);
  return params.toString();
};
