import { ChevronRight } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useCoreI18n } from "../../../i18n";
import type { ActivityEvent, ActivityEventTone } from "../helpers/activity-events";
import { formatListTime } from "../helpers/format";

export type { ActivityEvent, ActivityEventTone } from "../helpers/activity-events";

export const activityTone: Record<ActivityEventTone, string> = {
  audit: "border-slate-200 bg-slate-50 text-slate-700",
  commit: "border-sky-200 bg-sky-50 text-sky-800",
  change_request: "border-amber-200 bg-amber-50 text-amber-900",
  operation: "border-violet-200 bg-violet-50 text-violet-800",
  record: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export function ActivityRow({ event }: { event: ActivityEvent }) {
  const messages = useCoreI18n();
  const toneLabel: Record<ActivityEventTone, string> = {
    audit: messages.activity.audit,
    change_request: messages.activity.changeRequest,
    commit: messages.activity.commit,
    operation: messages.activity.operation,
    record: messages.activity.record,
  };

  return (
    <Link
      className="group grid min-h-16 items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-accent/25 md:grid-cols-[116px_minmax(0,1fr)_120px]"
      href={event.href}
    >
      <div>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 font-medium text-xs capitalize ${activityTone[event.tone]}`}
        >
          {toneLabel[event.tone]}
        </span>
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold text-sm leading-5">{event.title}</div>
        <div className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{event.body}</div>
      </div>
      <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs md:justify-end">
        <span className="font-mono">{formatListTime(event.timestamp)}</span>
        <ChevronRight
          className="shrink-0 transition-colors group-hover:text-foreground"
          size={14}
        />
      </div>
    </Link>
  );
}
