"use client";

/**
 * The card grid itself — skeletons, the unreachable-catalog notice, the empty
 * state, and the cards — with none of the page around it.
 *
 * Extracted from `TemplatesListView` when the New-item modal grew a "from a
 * template" tab. That view is a *page*: it owns an `h-full` scroll column, its
 * own heading, a search box and the repo link. The modal wants none of those —
 * it already has a title and a frame — but it wants exactly this grid, with the
 * same four states handled the same way. So the grid lives here once and both
 * callers pass it templates they fetched themselves.
 *
 * Deliberately presentational: no query, no catalog knowledge. The page keeps
 * its refresh button (which has to bypass the *server's* cache by changing the
 * query input) and the modal keeps its one-line read; neither has to explain
 * itself to the other.
 */

import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { ShimmerSkeleton as Skeleton } from "../../dashboard/components/shimmer-skeleton";
import { TemplateCardSummary, type TemplateStatLabels } from "./template-card-summary";

const TEMPLATE_SKELETON_IDS = [
  "template-skeleton-1",
  "template-skeleton-2",
  "template-skeleton-3",
  "template-skeleton-4",
  "template-skeleton-5",
  "template-skeleton-6",
];

export function TemplateCard({
  template,
  onOpen,
  density,
  statLabels,
}: {
  template: TemplateCardVO;
  onOpen: () => void;
  density?: "compact" | "comfortable";
  statLabels?: TemplateStatLabels;
}) {
  return (
    <button
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/50"
      onClick={onOpen}
      type="button"
    >
      <TemplateCardSummary
        density={density}
        screenshotAlt=""
        statLabels={statLabels}
        template={template}
      />
    </button>
  );
}

export function TemplateGrid({
  templates,
  isPending,
  error,
  emptyLabel,
  onOpenTemplate,
  density,
  statLabels,
  columnsClassName = "sm:grid-cols-2 lg:grid-cols-3",
  skeletonCount = TEMPLATE_SKELETON_IDS.length,
}: {
  templates: readonly TemplateCardVO[];
  isPending: boolean;
  /**
   * The catalog is fetched from a remote repository, so "unreachable" and
   * "empty" are different answers that look identical to a user — and only one
   * of them is actionable. Passing the catalog's own error through keeps them
   * apart wherever this grid renders.
   */
  error?: string | null;
  emptyLabel: string;
  onOpenTemplate: (template: TemplateCardVO) => void;
  density?: "compact" | "comfortable";
  statLabels?: TemplateStatLabels;
  /** Grid columns — the modal is narrower than the page and says so here. */
  columnsClassName?: string;
  skeletonCount?: number;
}) {
  if (isPending) {
    return (
      <div aria-hidden className={`grid gap-4 ${columnsClassName}`}>
        {TEMPLATE_SKELETON_IDS.slice(0, skeletonCount).map((id) => (
          <div className="overflow-hidden rounded-lg border border-border bg-card" key={id}>
            <Skeleton className="aspect-[16/10] w-full rounded-none" />
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-xs">
        {error}
      </p>
    );
  }

  if (templates.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <div className={`grid gap-4 ${columnsClassName}`}>
      {templates.map((template) => (
        <TemplateCard
          density={density}
          key={template.id}
          onOpen={() => onOpenTemplate(template)}
          statLabels={statLabels}
          template={template}
        />
      ))}
    </div>
  );
}
