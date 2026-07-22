import {
  CheckCircle2,
  ChevronRight,
  Eye,
  GitCommitHorizontal,
  type LucideIcon,
  MessageSquareText,
  PencilLine,
} from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import type { ActivityEvent, ActivityEventTone } from "../helpers/activity-events";
import { formatDetailTime, formatListTime } from "../helpers/format";

export type { ActivityEvent, ActivityEventTone } from "../helpers/activity-events";

const activityAvatarTone: Record<ActivityEventTone, string> = {
  audit: "border-border bg-muted/40 text-muted-foreground",
  commit: "border-border bg-muted/40 text-muted-foreground",
  change_request: "border-review/35 bg-review/10 text-review-strong dark:text-review-soft",
  operation: "border-border bg-muted/40 text-muted-foreground",
  record: "border-merged/35 bg-merged/10 text-merged-strong dark:text-merged-soft",
};

const activityIconTone: Record<ActivityEventTone, string> = {
  audit: "border-border bg-background text-muted-foreground",
  commit: "border-border bg-background text-muted-foreground",
  change_request: "border-review/35 bg-background text-review-strong dark:text-review-soft",
  operation: "border-border bg-background text-muted-foreground",
  record: "border-merged/35 bg-background text-merged-strong dark:text-merged-soft",
};

const activityIcons = {
  audit: Eye,
  change_request: MessageSquareText,
  commit: GitCommitHorizontal,
  operation: PencilLine,
  record: CheckCircle2,
} satisfies Record<ActivityEventTone, LucideIcon>;

const getInitials = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "U";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
};

function ActivityAvatar({ event }: { event: ActivityEvent }) {
  const Icon = activityIcons[event.tone];

  return (
    <div className="relative mt-0.5 size-10 shrink-0">
      <div
        className={`flex size-10 items-center justify-center overflow-hidden rounded-full border text-xs font-semibold ${activityAvatarTone[event.tone]}`}
      >
        {event.actorImage ? (
          <img
            alt=""
            aria-hidden="true"
            className="size-full object-cover"
            src={event.actorImage}
          />
        ) : (
          <span>{getInitials(event.actorName)}</span>
        )}
      </div>
      <span
        className={`-bottom-0.5 -right-0.5 absolute flex size-4 items-center justify-center rounded-full border ${activityIconTone[event.tone]}`}
      >
        <Icon aria-hidden="true" size={10} strokeWidth={2.4} />
      </span>
    </div>
  );
}

function ActivityProvenanceByline({ event }: { event: ActivityEvent }) {
  if (!event.provenance?.byline) {
    return null;
  }

  return (
    <div className="mt-1 min-w-0 truncate text-muted-foreground text-xs leading-5">
      {event.provenance.byline}
    </div>
  );
}

export function ActivityRow({ event }: { event: ActivityEvent }) {
  return (
    <Link
      className="group block rounded-md px-2 text-sm transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      href={event.href}
    >
      <div className="flex min-w-0 gap-3">
        <div className="relative flex w-11 shrink-0 justify-center pt-3">
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/60 transition-colors group-hover:bg-border"
          />
          <ActivityAvatar event={event} />
        </div>
        <div className="min-w-0 flex-1 border-border/50 border-b py-3.5 pr-2 transition-colors group-hover:border-transparent">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="min-w-0 max-w-full truncate font-semibold text-foreground">
                  {event.actorName}
                </span>
                <span className="text-muted-foreground">{event.actionLabel}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 pt-0.5 font-mono text-muted-foreground text-xs">
              <span>{formatListTime(event.timestamp)}</span>
              <ChevronRight
                aria-hidden="true"
                className="shrink-0 transition-colors group-hover:text-foreground"
                size={14}
              />
            </div>
          </div>
          <div className="mt-1.5 line-clamp-2 font-semibold leading-5">{event.title}</div>
          {event.body ? (
            <p className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-5">
              {event.body}
            </p>
          ) : null}
          <ActivityProvenanceByline event={event} />
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            {event.sourceLabel ? (
              <>
                <span className="min-w-0 truncate">{event.sourceLabel}</span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span className="font-mono">{formatDetailTime(event.timestamp)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
