"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { AppWindow, ExternalLink, RefreshCw, Sparkles, Table2 } from "lucide-react";
import { useMemo, useState } from "react";

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

/** "3 tables · 1 app · 7 sample rows" — what installing this actually creates. */
function StatLine({ stats }: { stats: TemplateCardVO["stats"] }) {
  const parts: string[] = [];
  if (stats.bases > 0) parts.push(`${stats.bases} table${stats.bases === 1 ? "" : "s"}`);
  if (stats.airapps > 0) parts.push(`${stats.airapps} app${stats.airapps === 1 ? "" : "s"}`);
  if (stats.docs > 0) parts.push(`${stats.docs} doc${stats.docs === 1 ? "" : "s"}`);
  if (stats.records > 0) parts.push(`${stats.records} sample rows`);
  return <span className="text-muted-foreground text-xs">{parts.join(" · ")}</span>;
}

function TemplateCard({ template, onOpen }: { template: TemplateCardVO; onOpen: () => void }) {
  const [shot] = template.screenshots;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/50"
    >
      <div className="flex aspect-[16/10] items-center justify-center overflow-hidden bg-muted">
        {shot ? (
          // Screenshots live in the source repository, so a missing or renamed
          // file must degrade to the placeholder rather than a broken-image
          // icon — the card is still useful without it.
          <img
            src={shot}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-top"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <Sparkles className="size-8 text-muted-foreground/40" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-sm">{template.name}</span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {template.category}
          </Badge>
        </div>
        <p className="line-clamp-2 flex-1 text-muted-foreground text-xs">{template.description}</p>
        <div className="flex items-center gap-2">
          {template.stats.bases > 0 ? <Table2 className="size-3 text-muted-foreground" /> : null}
          {template.stats.airapps > 0 ? (
            <AppWindow className="size-3 text-muted-foreground" />
          ) : null}
          <StatLine stats={template.stats} />
        </div>
      </div>
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl">Templates</h1>
        <p className="text-muted-foreground text-sm">
          Complete apps — tables, an interface, and the manual an agent reads before it touches your
          data. Installing one fills in its tables, and proposes the app itself for your review.
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
          Browsing is open to everyone. Installing a template is a space owner or admin action — it
          can carry an app and a skill, which is code this space's agents will run.
        </p>
      ) : null}

      {catalog.isPending ? (
        <p className="text-muted-foreground text-sm">Loading the catalog…</p>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onOpen={() => onOpenTemplate(template)}
          />
        ))}
      </div>
    </div>
  );
}
