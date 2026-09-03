"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { ChangeRequestVO } from "busabase-contract/types";
import { ChevronRight } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { AppLauncherGrid } from "../../airapp/components/app-launcher";
import { type ActivityEvent, buildActivityEventFromItem } from "../helpers/activity-events";
import {
  getChangeRequestScopeName,
  getChangeRequestTitle,
  statusTone,
} from "../helpers/change-request";
import { formatListTime } from "../helpers/format";
import {
  HOME_ACTIVITY_PREVIEW_COUNT,
  HOME_PENDING_PREVIEW_COUNT,
  HOME_RECENT_APPS_PREVIEW_COUNT,
  HOME_RECENT_PREVIEW_COUNT,
  isHomeDigestEmpty,
  selectPendingChangeRequests,
} from "../helpers/home";
import type { KnownNode, KnownNodeCache } from "../helpers/known-node-cache";
import { useHrefWithCurrentSearch } from "../helpers/link-search";
import { nodeIconForType } from "../helpers/node-icons";
import { ActivityRow } from "./activity";
import { InboxListSkeleton } from "./skeletons";

function HomeSection({
  action,
  children,
  count,
  name,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  /** Optional running total shown beside the title (e.g. "22 pending"). */
  count?: string;
  /** Stable hook for tests, mirroring `data-dashboard-scroll` elsewhere — the
   * section's heading is localized, and its wrapper is nested inside HomeView's
   * own `<section>`, so neither is a reliable selector. */
  name: string;
  title: string;
}) {
  return (
    <section className="min-w-0" data-home-section={name}>
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="min-w-0 truncate font-medium text-muted-foreground text-xs">{title}</h2>
          {count ? (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{count}</span>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "Review all" / "View all activity" — the escape hatch from a preview to its full page. */
function HomeSectionLink({ href, label }: { href: string; label: string }) {
  const resolvedHref = useHrefWithCurrentSearch(href);

  return (
    <Link
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent/40 hover:text-foreground"
      href={resolvedHref}
    >
      {label}
      <ChevronRight aria-hidden="true" size={13} />
    </Link>
  );
}

/** Button-flavored sibling of `HomeSectionLink` for "view all" actions that
 * open UI state rather than navigate — e.g. the Recent section's escape
 * hatch is the Search dialog's own Recent tab, not a route. */
function HomeSectionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent/40 hover:text-foreground"
      onClick={onClick}
      type="button"
    >
      {label}
      <ChevronRight aria-hidden="true" size={13} />
    </button>
  );
}

function HomeSectionHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-border/50 border-dashed px-3 py-3 text-muted-foreground text-xs">
      {children}
    </p>
  );
}

function PendingReviewRow({ changeRequest }: { changeRequest: ChangeRequestVO }) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const href = useHrefWithCurrentSearch(`/inbox/${changeRequest.id}`);

  return (
    <Link
      className="group flex min-w-0 items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-accent/25"
      href={href}
    >
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full border ${statusTone(changeRequest.status)}`}
      />
      <span className="min-w-0 flex-1 truncate font-medium text-sm">
        {getChangeRequestTitle(changeRequest, messages)}
      </span>
      <span className="hidden min-w-0 max-w-[12rem] shrink-0 truncate text-muted-foreground text-xs sm:block">
        {getChangeRequestScopeName(changeRequest, messages)}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
        {formatListTime(changeRequest.updatedAt, locale)}
      </span>
    </Link>
  );
}

function RecentNodeCard({ node }: { node: KnownNode }) {
  const href = useHrefWithCurrentSearch(node.path);
  const Icon = nodeIconForType(node.type);

  return (
    <Link
      className="group flex min-w-0 items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3 py-2.5 transition-colors hover:border-border hover:bg-accent/25"
      href={href}
    >
      <Icon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
      />
      <span className="min-w-0 flex-1 truncate font-medium text-sm">{node.name}</span>
    </Link>
  );
}

/**
 * The workbench landing page. Answers "where do I pick up?" with three stacked
 * signals — what needs you, what you were last in, what the workspace has been
 * doing — instead of dropping every visitor straight into Inbox, whose empty
 * state reads as "nothing here for you" to anyone without a pending review.
 *
 * Deliberately read-only: reviewing, browsing and auditing all still happen on
 * their own pages, which each section links out to.
 */
export function HomeView({
  changeRequests,
  emptyGuide,
  isChangeRequestsLoaded = true,
  nodeCache,
  onOpenSearch,
  orpc,
}: {
  /** Already-loaded change requests from the dashboard — no extra request needed. */
  changeRequests: ChangeRequestVO[];
  /** Onboarding guide shown when the workspace has nothing to show at all. */
  emptyGuide?: ReactNode;
  /** False while an empty SSR seed is still being replaced by the first real CR response. */
  isChangeRequestsLoaded?: boolean;
  /** Scoped known-node cache; its `visited` list IS the recently-visited feed. */
  nodeCache: KnownNodeCache;
  /** Opens the Search dialog (defaults to its Recent tab) — used by the
   * "Recently visited" section's "view all" action, since that list has no
   * dedicated route of its own. */
  onOpenSearch: () => void;
  orpc: BusabaseQueryUtils;
}) {
  const messages = useCoreI18n();
  const home = messages.home;

  const pendingChangeRequests = useMemo(
    () => selectPendingChangeRequests(changeRequests),
    [changeRequests],
  );

  // Same store the search dialog reads — visiting a node anywhere in the app
  // already records it, so this feed needs no tracking of its own.
  const nodeCacheSnapshot = useSyncExternalStore(
    nodeCache.subscribe,
    nodeCache.getSnapshot,
    nodeCache.getSnapshot,
  );
  const recentNodes = nodeCacheSnapshot.visited.slice(0, HOME_RECENT_PREVIEW_COUNT);
  const recentAppNodes = useMemo(
    () =>
      nodeCacheSnapshot.visited
        .filter((node) => node.type === "airapp")
        .slice(0, HOME_RECENT_APPS_PREVIEW_COUNT),
    [nodeCacheSnapshot.visited],
  );

  const activityQuery = useQuery(
    orpc.activity.listPaged.queryOptions({ input: { limit: HOME_ACTIVITY_PREVIEW_COUNT } }),
  );
  const activityEvents = useMemo(
    () =>
      (activityQuery.data?.items ?? [])
        .map((item) => buildActivityEventFromItem(item, messages))
        .filter((event): event is ActivityEvent => event !== null),
    [activityQuery.data, messages],
  );

  // A brand-new workspace gets the onboarding guide rather than three empty shells.
  const isEverythingEmpty = isHomeDigestEmpty({
    activityCount: activityEvents.length,
    isActivityLoaded: !activityQuery.isPending,
    isChangeRequestsLoaded,
    pendingCount: pendingChangeRequests.length,
    recentCount: recentNodes.length,
  });

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5" data-dashboard-scroll="home">
        {isEverythingEmpty && emptyGuide ? (
          emptyGuide
        ) : (
          <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6">
            {/* Only rendered when something is genuinely waiting — an empty
                "Waiting for your review" card is exactly the cold greeting this
                landing page exists to avoid. */}
            {pendingChangeRequests.length > 0 ? (
              <HomeSection
                // `?view=review` is spelled out because SPALink merges the
                // current query string in: a bare `/inbox` would inherit
                // whatever `view` the user last left behind, so "View all"
                // under a "Waiting for your review" list could land on Merged.
                action={<HomeSectionLink href="/inbox?view=review" label={home.pendingViewAll} />}
                count={fmt(home.pendingCount, { count: pendingChangeRequests.length })}
                name="pending"
                title={home.pendingTitle}
              >
                <div className="overflow-hidden rounded-lg border border-review/35 bg-review/5 divide-y divide-border/50">
                  {pendingChangeRequests
                    .slice(0, HOME_PENDING_PREVIEW_COUNT)
                    .map((changeRequest) => (
                      <PendingReviewRow changeRequest={changeRequest} key={changeRequest.id} />
                    ))}
                </div>
              </HomeSection>
            ) : null}

            <HomeSection
              action={
                recentNodes.length > 0 ? (
                  <HomeSectionButton label={home.recentViewAll} onClick={onOpenSearch} />
                ) : undefined
              }
              name="recent"
              title={home.recentTitle}
            >
              {recentNodes.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {recentNodes.map((node) => (
                    <RecentNodeCard key={node.id} node={node} />
                  ))}
                </div>
              ) : (
                <HomeSectionHint>{home.recentEmptyBody}</HomeSectionHint>
              )}
            </HomeSection>

            {recentAppNodes.length > 0 ? (
              <HomeSection
                action={<HomeSectionLink href="/apps" label={home.recentAppsViewAll} />}
                name="recentApps"
                title={home.recentAppsTitle}
              >
                <AppLauncherGrid nodes={recentAppNodes} />
              </HomeSection>
            ) : null}

            <HomeSection
              action={<HomeSectionLink href="/activity" label={home.activityViewAll} />}
              name="activity"
              title={home.activityTitle}
            >
              {activityQuery.isPending ? (
                <InboxListSkeleton />
              ) : activityEvents.length > 0 ? (
                <div>
                  {activityEvents.map((event) => (
                    <ActivityRow event={event} key={event.id} />
                  ))}
                </div>
              ) : (
                <HomeSectionHint>{home.activityEmptyBody}</HomeSectionHint>
              )}
            </HomeSection>
          </div>
        )}
      </div>
    </section>
  );
}
