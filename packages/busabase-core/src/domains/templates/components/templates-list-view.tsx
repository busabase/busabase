"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { ShimmerSkeleton as Skeleton } from "../../dashboard/components/shimmer-skeleton";
import { TemplateCardSummary } from "./template-card-summary";

const TEMPLATE_SKELETON_IDS = [
  "template-skeleton-1",
  "template-skeleton-2",
  "template-skeleton-3",
  "template-skeleton-4",
  "template-skeleton-5",
  "template-skeleton-6",
];

interface TemplatesListViewProps {
  orpc: BusabaseQueryUtils;
  onOpenTemplate: (template: TemplateCardVO) => void;
  /**
   * False for a member: the cards still render, the buttons explain instead of
   * disappearing. A door that is simply missing reads as a broken page; a door
   * that says who can open it reads as a rule.
   */
  canInstall: boolean;
}

function TemplateCard({ template, onOpen }: { template: TemplateCardVO; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/50"
    >
      <TemplateCardSummary template={template} screenshotAlt="" />
    </button>
  );
}

/**
 * The Template Center: what you can install, before you have to know a URL.
 *
 * Everything here comes from a catalog built out of a skills repository, so the
 * gallery and `npx skills add` show the same set — a template visible in one and
 * not the other is a bug users experience as "the docs lied".
 */
export function TemplatesListView({ orpc, onOpenTemplate, canInstall }: TemplatesListViewProps) {
  const [search, setSearch] = useState("");
  /**
   * The refresh button has to reach past the SERVER's hour-long cache, not just
   * react-query's. Refetching the default query would re-ask for the same
   * cached answer, so the first click switches the input — and therefore the
   * query key — to `{ refresh: true }`; later clicks refetch that key, which
   * still carries the flag. A button that visibly spins and changes nothing is
   * worse than no button.
   */
  const [bypassServerCache, setBypassServerCache] = useState(false);
  const catalog = useQuery(
    orpc.templates.list.queryOptions({ input: bypassServerCache ? { refresh: true } : {} }),
  );

  const refresh = () => {
    if (bypassServerCache) void catalog.refetch();
    else setBypassServerCache(true);
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = catalog.data?.templates ?? [];
    if (!needle) return all;
    return all.filter((template) =>
      [template.name, template.description, template.category, ...template.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [catalog.data, search]);

  return (
    // The page owns its own scrolling, the way Inbox and the review pages do: a
    // full-height column whose inner region scrolls.
    //
    // `h-full` is the load-bearing class, not `flex-1`. The host slot
    // (`data-dashboard-active-view`) is a plain block box with a definite
    // height and `overflow-hidden` — it is NOT a flex container — so a child's
    // `flex-1` is inert and its height resolves to `auto`. The column then
    // grows to its content, the inner `overflow-y-auto` never has anything to
    // overflow, and the page is simply clipped: no scrollbar, bottom
    // unreachable. `h-full` adopts the slot's height, which is what gives the
    // inner region a bound to scroll within.
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          <div className="flex flex-col gap-1">
            <h1 className="font-serif text-2xl">Templates</h1>
            <p className="text-muted-foreground text-sm">
              Complete apps — tables, an interface, and the manual an agent reads before it touches
              your data. Installing one fills in its tables, and proposes the app itself for your
              review.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search templates…"
              className="max-w-xs"
            />
            <Button variant="ghost" size="sm" onClick={refresh} disabled={catalog.isFetching}>
              <RefreshCw className={catalog.isFetching ? "size-4 animate-spin" : "size-4"} />
            </Button>
            {catalog.data?.repo ? (
              <a
                href={`https://github.com/${catalog.data.repo}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
              >
                {catalog.data.repo}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>

          {!canInstall ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-muted-foreground text-xs">
              Browsing is open to everyone. Installing a template is a space owner or admin action —
              it can carry an app and a skill, which is code this space's agents will run.
            </p>
          ) : null}

          {catalog.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
              {TEMPLATE_SKELETON_IDS.map((id) => (
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
          ) : null}

          {/* An unreachable catalog and an empty one look identical to a user, and
          only one of them is actionable — so say which this is. */}
          {catalog.data?.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-xs">
              {catalog.data.error}
            </p>
          ) : null}

          {catalog.data && !catalog.data.error && filtered.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {search ? `Nothing matches “${search}”.` : "This catalog has no templates yet."}
            </p>
          ) : null}

          {!catalog.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onOpen={() => onOpenTemplate(template)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
