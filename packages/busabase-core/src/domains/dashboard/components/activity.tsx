import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
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
import { useMemo } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import {
  type ActivityEvent,
  type ActivityEventTone,
  buildActivityEventFromItem,
} from "../helpers/activity-events";
import { formatDetailTime, formatListTime } from "../helpers/format";
import { InboxListSkeleton } from "./skeletons";

export type { ActivityEvent, ActivityEventTone } from "../helpers/activity-events";

const activityAvatarTone: Record<ActivityEventTone, string> = {
  audit: "border-border bg-muted/40 text-muted-foreground",
  commit: "border-border bg-muted/40 text-muted-foreground",
  change_request: "border-review/35 bg-review/17 text-review-strong dark:text-review-soft",
  operation: "border-border bg-muted/40 text-muted-foreground",
  record: "border-merged/35 bg-merged/17 text-merged-strong dark:text-merged-soft",
};

const activityIconTone: Record<ActivityEventTone, string> = {
  audit: "border-border bg-card text-muted-foreground",
  commit: "border-border bg-card text-muted-foreground",
  change_request: "border-review/35 bg-card text-review-strong dark:text-review-soft",
  operation: "border-border bg-card text-muted-foreground",
  record: "border-merged/35 bg-card text-merged-strong dark:text-merged-soft",
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
  const locale = useCoreLocale();

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
              <span>{formatListTime(event.timestamp, locale)}</span>
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
            <span className="font-mono">{formatDetailTime(event.timestamp, locale)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

/**
 * A single node's raw activity stream (no version-number aggregation), reusing
 * `ActivityRow` so it looks identical to the global feed on `/activity` and
 * on `home.tsx`. Backed by `activity.listForNode` — a flat, newest-first list,
 * not the global feed's keyset pagination.
 */
export function NodeActivityPanel({ nodeId, orpc }: { nodeId: string; orpc: BusabaseQueryUtils }) {
  const messages = useCoreI18n();
  const activityQuery = useQuery(
    orpc.activity.listForNode.queryOptions({ input: { nodeId, limit: 50 } }),
  );
  const activityEvents = useMemo(
    () =>
      (activityQuery.data ?? [])
        .map((item) => buildActivityEventFromItem(item, messages))
        .filter((event): event is ActivityEvent => event !== null),
    [activityQuery.data, messages],
  );

  if (activityQuery.isPending) {
    return <InboxListSkeleton />;
  }

  if (activityEvents.length === 0) {
    return (
      <p className="px-2 py-3 text-muted-foreground text-sm">
        {messages.nodeDetail.activityEmptyBody}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 px-1 py-1">
      {activityEvents.map((event) => (
        <ActivityRow event={event} key={event.id} />
      ))}
    </div>
  );
}

/**
 * Full-page wrapper around `NodeActivityPanel`, for the routed
 * `/{type}/:slug/activity` (and `/base/:slug/activity`) sub-page — the
 * "•••" menu's Activity item navigates here instead of opening a popover.
 * Same header/scroll-container shape as `ActivityView` (the global
 * `/activity` feed) in `inbox.tsx`, just scoped to one node.
 */
export function NodeActivityView({
  nodeId,
  orpc,
  breadcrumb,
}: {
  nodeId: string;
  orpc: BusabaseQueryUtils;
  breadcrumb?: string;
}) {
  const messages = useCoreI18n();

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-2.5">
        <div className="font-medium text-sm">
          {breadcrumb
            ? `${breadcrumb} · ${messages.nodeDetail.activity}`
            : messages.nodeDetail.activity}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5"
        data-dashboard-scroll="activity"
      >
        <NodeActivityPanel nodeId={nodeId} orpc={orpc} />
      </div>
    </section>
  );
}

/**
 * Record-scoped mirror of `NodeActivityPanel` — backed by
 * `activity.listForRecord` instead of `activity.listForNode`. Same reuse of
 * `ActivityRow`/`buildActivityEventFromItem`, just a different query.
 */
export function RecordActivityPanel({
  recordId,
  orpc,
}: {
  recordId: string;
  orpc: BusabaseQueryUtils;
}) {
  const messages = useCoreI18n();
  const activityQuery = useQuery(
    orpc.activity.listForRecord.queryOptions({ input: { recordId, limit: 50 } }),
  );
  const activityEvents = useMemo(
    () =>
      (activityQuery.data ?? [])
        .map((item) => buildActivityEventFromItem(item, messages))
        .filter((event): event is ActivityEvent => event !== null),
    [activityQuery.data, messages],
  );

  if (activityQuery.isPending) {
    return <InboxListSkeleton />;
  }

  if (activityEvents.length === 0) {
    return (
      <p className="px-2 py-3 text-muted-foreground text-sm">
        {messages.nodeDetail.activityEmptyBody}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 px-1 py-1">
      {activityEvents.map((event) => (
        <ActivityRow event={event} key={event.id} />
      ))}
    </div>
  );
}

/**
 * Full-page wrapper around `RecordActivityPanel`, for the routed
 * `/base/:slug/:recordId/activity` sub-page — reached from the Record
 * detail view's "•••" menu, same pattern as `NodeActivityView`.
 */
export function RecordActivityView({
  recordId,
  orpc,
  breadcrumb,
}: {
  recordId: string;
  orpc: BusabaseQueryUtils;
  breadcrumb?: string;
}) {
  const messages = useCoreI18n();

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-2.5">
        <div className="font-medium text-sm">
          {breadcrumb
            ? `${breadcrumb} · ${messages.nodeDetail.activity}`
            : messages.nodeDetail.activity}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5"
        data-dashboard-scroll="activity"
      >
        <RecordActivityPanel orpc={orpc} recordId={recordId} />
      </div>
    </section>
  );
}
