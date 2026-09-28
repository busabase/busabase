"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  PlaybookListItemVO,
  PlaybookMatchField,
  PlaybookSearchItemVO,
  PlaybookUsageVO,
} from "busabase-contract/contract/playbook-schemas";
import type { NodeType } from "busabase-contract/domains";
import { Button } from "kui/button";
import { BookOpen, ExternalLink, Search, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { type CoreI18nMessages, fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { formatRelativeTime } from "../helpers/format";
import { nodeRoutePath } from "../helpers/known-node-cache";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { NodeAvatar } from "../helpers/node-icons";
import { NodeAgentPromptsDialog } from "./node-agent-prompts-dialog";
import { EmptyState } from "./primitives";

interface Props {
  orpc: BusabaseQueryUtils;
}

type KindFilter = "all" | "skill" | "prompt";

/** The fields a list row and a search row share — everything a row renders. */
type PlaybookRowItem = Pick<
  PlaybookListItemVO,
  | "kind"
  | "nodeId"
  | "nodeType"
  | "nodeName"
  | "nodeSlug"
  | "path"
  | "key"
  | "label"
  | "intent"
  | "name"
  | "description"
  | "bodyPreview"
>;

interface PromptsTarget {
  nodeId: string;
  nodeName: string;
  nodeType: string;
}

const rowKey = (item: PlaybookRowItem): string =>
  item.kind === "skill" ? `skill:${item.nodeId}` : `prompt:${item.nodeId}:${item.key ?? ""}`;

/**
 * Space-level Playbooks page — "Busabase Playbooks for Agents"
 * (agent-playbook-discovery.md §11b H2).
 *
 * Audience: the person who WRITES playbooks. Two questions, two halves:
 *
 * - "Will an agent find mine if I say X?" — the try-it box runs the real
 *   `playbooks.search` with that one sentence. It is a literal preview and
 *   says so: a real agent adds its own rephrasings (and English), so it can
 *   only find the same or more.
 * - "What playbooks exist here?" — the catalog from `playbooks.list`, every
 *   skill and custom prompt the viewer can read, grouped by folder.
 *
 * This is an authoring aid, not a place agents go: they use the ranked search.
 */
export function PlaybooksView({ orpc }: Props) {
  const messages = useCoreI18n();
  const t = messages.playbooksPage;
  const locale = useCoreLocale();
  const currentSearch = useSearch();
  const queryClient = useQueryClient();
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [promptsTarget, setPromptsTarget] = useState<PromptsTarget | null>(null);

  const catalog = useQuery(orpc.playbooks.list.queryOptions({ input: { locale } }));
  const trySentence = submitted.trim();
  const tryResult = useQuery({
    ...orpc.playbooks.search.queryOptions({ input: { queries: [trySentence], locale } }),
    enabled: trySentence.length > 0,
    // A failed preview is answered once; retrying just delays the message.
    retry: false,
  });

  const items = catalog.data?.items ?? [];
  const counts = useMemo(
    () => ({
      all: items.length,
      skill: items.filter((item) => item.kind === "skill").length,
      prompt: items.filter((item) => item.kind === "prompt").length,
    }),
    [items],
  );
  const groups = useMemo(() => {
    // `playbooks.list` already sorts by folder path, so grouping keeps order.
    const byPath = new Map<string, { label: string; items: PlaybookListItemVO[] }>();
    for (const item of items) {
      if (kindFilter !== "all" && item.kind !== kindFilter) continue;
      const pathKey = item.path.join("/");
      const group = byPath.get(pathKey) ?? {
        label: item.path.length > 0 ? item.path.join(" / ") : t.rootGroup,
        items: [],
      };
      group.items.push(item);
      byPath.set(pathKey, group);
    }
    return [...byPath.entries()].map(([pathKey, group]) => ({ pathKey, ...group }));
  }, [items, kindFilter, t.rootGroup]);

  const hrefFor = (item: PlaybookRowItem) =>
    mergeSearchIntoHref(nodeRoutePath(item.nodeType as NodeType, item.nodeSlug), currentSearch);
  const openPrompts = (item: PlaybookRowItem) =>
    setPromptsTarget({ nodeId: item.nodeId, nodeName: item.nodeName, nodeType: item.nodeType });

  const filterOptions: { key: KindFilter; label: string }[] = [
    { key: "all", label: t.filterAll },
    { key: "skill", label: t.filterSkills },
    { key: "prompt", label: t.filterPrompts },
  ];

  return (
    // `h-full` + `min-h-0`: the dashboard mounts a view into a block slot, so a
    // view that only sets `flex-1` is silently cropped with no scrollbar.
    <section className="flex h-full min-h-0 flex-col" data-dashboard-scroll="playbooks">
      <header className="shrink-0 border-border border-b px-4 py-4 md:px-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
            <BookOpen className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-semibold text-foreground text-lg">{t.title}</h1>
            <p className="mt-0.5 max-w-3xl text-muted-foreground text-sm">{t.description}</p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {/* ── Try it ─────────────────────────────────────────────────────── */}
        <section
          aria-labelledby="playbooks-try-title"
          className="rounded-lg border border-border bg-card p-4"
        >
          <h2 className="font-medium text-foreground text-sm" id="playbooks-try-title">
            {t.tryTitle}
          </h2>
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(draft);
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                aria-label={t.tryLabel}
                className="min-w-0 flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t.tryPlaceholder}
                value={draft}
              />
              {draft ? (
                <button
                  aria-label={messages.common.cancel}
                  onClick={() => {
                    setDraft("");
                    setSubmitted("");
                  }}
                  type="button"
                >
                  <X className="size-4 text-muted-foreground hover:text-foreground" />
                </button>
              ) : null}
            </div>
            <Button disabled={draft.trim().length === 0} size="sm" type="submit">
              {t.trySubmit}
            </Button>
          </form>
          <p className="mt-2 text-muted-foreground text-xs">{t.tryNote}</p>

          {trySentence ? (
            <div aria-live="polite" className="mt-3">
              {tryResult.isPending ? (
                <p className="py-2 text-muted-foreground text-sm">{t.tryLoading}</p>
              ) : tryResult.isError ? (
                <div className="py-2 text-destructive text-sm">
                  <p>{t.tryFailed}</p>
                  <button
                    className="mt-2 rounded-md border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-muted"
                    onClick={() => tryResult.refetch()}
                    type="button"
                  >
                    {t.retry}
                  </button>
                </div>
              ) : tryResult.data.items.length === 0 ? (
                <div className="rounded-md bg-muted/40 px-3 py-3" data-testid="playbooks-try-empty">
                  <p className="font-medium text-foreground text-sm">{t.tryNoMatchesTitle}</p>
                  <p className="mt-1 text-muted-foreground text-xs">{t.tryNoMatchesBody}</p>
                </div>
              ) : (
                <>
                  <p className="pb-1 text-muted-foreground text-xs">
                    {fmt(t.tryResultCount, {
                      shown: tryResult.data.items.length,
                      total: tryResult.data.total,
                    })}
                  </p>
                  <ol className="space-y-0.5" data-testid="playbooks-try-results">
                    {tryResult.data.items.map((item) => (
                      <li key={rowKey(item)}>
                        <PlaybookRow
                          extra={<MatchedOn fields={item.matchedOn} t={t} />}
                          href={hrefFor(item)}
                          item={item}
                          onOpenPrompts={() => openPrompts(item)}
                          showPath
                          t={t}
                        />
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          ) : null}
        </section>

        {/* ── Catalog ────────────────────────────────────────────────────── */}
        <section aria-labelledby="playbooks-catalog-title" className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium text-foreground text-sm" id="playbooks-catalog-title">
              {t.catalogTitle}
              {catalog.data ? (
                <span className="ml-2 font-normal text-muted-foreground text-xs">
                  {fmt(t.catalogCount, { count: catalog.data.total })}
                </span>
              ) : null}
            </h2>
            {catalog.data && catalog.data.total > 0 ? (
              <fieldset className="inline-flex overflow-hidden rounded-lg border border-border">
                <legend className="sr-only">{t.catalogTitle}</legend>
                {filterOptions.map((option) => (
                  <button
                    aria-pressed={kindFilter === option.key}
                    className={`px-2.5 py-1.5 text-xs transition-colors ${
                      kindFilter === option.key
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                    key={option.key}
                    onClick={() => setKindFilter(option.key)}
                    type="button"
                  >
                    {option.label}
                    <span className="ml-1 opacity-70">{counts[option.key]}</span>
                  </button>
                ))}
              </fieldset>
            ) : null}
          </div>

          <div className="mt-3">
            {catalog.isPending ? (
              <CatalogSkeleton label={messages.common.loadingPlain} />
            ) : catalog.isError ? (
              <EmptyState
                action={
                  <Button
                    onClick={() => catalog.refetch()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t.retry}
                  </Button>
                }
                body={t.loadFailedBody}
                icon={TriangleAlert}
                title={t.loadFailedTitle}
              />
            ) : catalog.data.total === 0 ? (
              <CatalogEmpty
                locale={locale}
                openFullGuideLabel={messages.integration.openFullGuide}
                t={t}
              />
            ) : groups.length === 0 ? (
              <p className="px-3 py-6 text-center text-muted-foreground text-sm">
                {t.emptyFilteredTitle}
              </p>
            ) : (
              <div className="space-y-5" data-testid="playbooks-catalog">
                {groups.map((group) => (
                  <section aria-label={group.label} key={group.pathKey}>
                    <h3 className="px-3 pb-1 font-medium text-muted-foreground text-xs">
                      {group.label}
                    </h3>
                    <ul className="space-y-0.5">
                      {group.items.map((item) => (
                        <li key={rowKey(item)}>
                          <PlaybookRow
                            extra={
                              item.usage ? (
                                <PlaybookUsage locale={locale} t={t} usage={item.usage} />
                              ) : undefined
                            }
                            href={hrefFor(item)}
                            item={item}
                            onOpenPrompts={() => openPrompts(item)}
                            t={t}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {catalog.data.truncated ? (
                  <p className="px-3 text-muted-foreground text-xs">
                    {fmt(t.truncated, { shown: items.length, total: catalog.data.total })}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>

      {promptsTarget ? (
        <NodeAgentPromptsDialog
          nodeId={promptsTarget.nodeId}
          nodeName={promptsTarget.nodeName}
          nodeType={promptsTarget.nodeType}
          onOpenChange={(open) => {
            if (open) return;
            setPromptsTarget(null);
            // The dialog is where prompts are edited; whatever changed there
            // has to show up in the catalog and in the next preview.
            void queryClient.invalidateQueries({ queryKey: orpc.playbooks.key() });
          }}
          open
          orpc={orpc}
        />
      ) : null}
    </section>
  );
}

type PageMessages = CoreI18nMessages["playbooksPage"];

function PlaybookRow({
  item,
  href,
  onOpenPrompts,
  extra,
  showPath = false,
  t,
}: {
  item: PlaybookRowItem;
  href: string;
  onOpenPrompts: () => void;
  extra?: ReactNode;
  /** Search results are not grouped, so they name their folder inline. */
  showPath?: boolean;
  t: PageMessages;
}) {
  const isPrompt = item.kind === "prompt";
  const title = (isPrompt ? item.label : item.name) ?? item.nodeName;
  const secondary = isPrompt ? item.bodyPreview : item.description || t.noDescription;
  const location = [
    showPath ? (item.path.length > 0 ? item.path.join(" / ") : t.rootGroup) : null,
    isPrompt ? fmt(t.onNode, { node: item.nodeName }) : null,
  ].filter(Boolean);
  return (
    <div
      className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted"
      data-playbook-kind={item.kind}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
        <NodeAvatar node={{ type: item.nodeType }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            className="truncate font-medium text-foreground text-sm hover:underline"
            href={href}
          >
            {title}
          </Link>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {isPrompt ? t.kindPrompt : t.kindSkill}
          </span>
          {isPrompt && item.intent ? (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                item.intent === "read-only"
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary/10 text-primary"
              }`}
            >
              {item.intent === "read-only" ? t.intentReadOnly : t.intentChange}
            </span>
          ) : null}
        </div>
        {secondary ? (
          <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{secondary}</p>
        ) : null}
        {location.length > 0 || extra ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {location.map((part) => (
              <span className="truncate" key={part}>
                {part}
              </span>
            ))}
            {extra}
          </div>
        ) : null}
      </div>
      {isPrompt ? (
        <Button
          className="shrink-0"
          onClick={onOpenPrompts}
          size="sm"
          type="button"
          variant="outline"
        >
          {t.openPrompts}
        </Button>
      ) : null}
    </div>
  );
}

function MatchedOn({ fields, t }: { fields: PlaybookSearchItemVO["matchedOn"]; t: PageMessages }) {
  if (fields.length === 0) return null;
  const labels: Record<PlaybookMatchField, string> = {
    name: t.matchName,
    slug: t.matchSlug,
    description: t.matchDescription,
    label: t.matchLabel,
    body: t.matchBody,
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span>{t.matchedOn}</span>
      {fields.map((field) => (
        <span
          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground"
          key={field}
        >
          {labels[field]}
        </span>
      ))}
    </span>
  );
}

/**
 * "Used 3× in 30 days · last 2 days ago", or a muted "Not used in 30 days"
 * badge. The only usage signal a person gets: a playbook agents never cite on
 * a change is one they are not finding (spec §11b H1). Counts come from
 * `playbooks.list` and cover only change requests the viewer can see.
 */
function PlaybookUsage({
  usage,
  locale,
  t,
}: {
  usage: PlaybookUsageVO;
  locale: string;
  t: PageMessages;
}) {
  const last = usage.lastUsedAt
    ? fmt(t.usageLast, { when: formatRelativeTime(usage.lastUsedAt, locale) })
    : null;
  if (usage.changeRequests30d === 0) {
    return (
      <span className="inline-flex items-center gap-1" data-testid="playbook-usage-unused">
        <span
          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
          title={t.usageUnusedHint}
        >
          {t.usageUnused}
        </span>
        {last ? <span>· {last}</span> : null}
        <span className="sr-only">{t.usageUnusedHint}</span>
      </span>
    );
  }
  return (
    <span data-testid="playbook-usage" title={t.usageHint}>
      {fmt(t.usageUsed, { count: usage.changeRequests30d })}
      {last ? ` · ${last}` : null}
    </span>
  );
}

/** Locales with a published `/docs/agent-playbooks` guide; every other UI language links the English one. */
const PLAYBOOK_DOC_LOCALES: readonly string[] = ["zh-CN", "ja"];

function getPlaybookGuideUrl(locale: string): string {
  return PLAYBOOK_DOC_LOCALES.includes(locale)
    ? `https://busabase.com/${locale}/docs/agent-playbooks`
    : "https://busabase.com/docs/agent-playbooks";
}

function CatalogEmpty({
  locale,
  openFullGuideLabel,
  t,
}: {
  locale: string;
  openFullGuideLabel: string;
  t: PageMessages;
}) {
  return (
    <div className="grid place-items-center px-6 py-12 text-center" data-testid="playbooks-empty">
      <div className="max-w-lg">
        <div className="mx-auto grid size-14 place-items-center rounded-xl border bg-card">
          <BookOpen size={24} />
        </div>
        <h3 className="mt-4 font-semibold text-foreground text-xl">{t.emptyTitle}</h3>
        <p className="mt-2 text-muted-foreground text-sm">{t.emptyBody}</p>
        <ul className="mt-4 space-y-1 text-left text-muted-foreground text-sm">
          <li>• {t.emptyHowSkill}</li>
          <li>• {t.emptyHowPrompt}</li>
        </ul>
        <p className="mt-4 text-muted-foreground text-xs">{t.emptyHelp}</p>
        <a
          className="mt-1.5 inline-flex items-center gap-1 text-primary text-xs hover:underline"
          href={getPlaybookGuideUrl(locale)}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink size={12} />
          {openFullGuideLabel}
        </a>
      </div>
    </div>
  );
}

function CatalogSkeleton({ label }: { label: string }) {
  return (
    <div aria-label={label} className="space-y-2" role="status">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="flex items-start gap-3 px-3 py-2.5" key={`playbook-skeleton-${index + 1}`}>
          <div className="size-7 shrink-0 animate-pulse rounded-lg bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
