import "server-only";

import type { TemplateCardVO, TemplateCatalogVO } from "busabase-contract/domains/templates/types";

/**
 * The Template Center's catalog, fetched from a skills repository.
 *
 * Server-side because the browser cannot do it well: the file is cross-origin,
 * a per-user fetch shares no cache, and letting the page name the host would
 * make "which catalog do I trust" a client-side decision. Here it is one env
 * var an operator sets.
 *
 * Spec: `apps/busabase/content/spec/template-center.md` §6.4.
 */

/**
 * Default catalog.
 *
 * A repository of its own rather than a corner of `busabase/skills`: that one is
 * cloned to install two general-purpose skills, and a single template — an app's
 * whole source, its screenshots, its sample data — was already three quarters of
 * its tracked bytes. Templates there would make every skill install pay for
 * every template.
 */
const DEFAULT_CATALOG_URL =
  "https://raw.githubusercontent.com/busabase/templates/main/templates.json";

/**
 * Cached for an hour.
 *
 * The catalog changes when someone merges a template, which is rare; a user
 * opening the gallery three times in a minute should not cost three round trips
 * to GitHub, and an operator behind a rate limit should not be able to exhaust
 * it by refreshing. The refresh button bypasses this, so nobody is ever stuck
 * with a stale answer they can see is stale.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface RawTemplate {
  subdir: string;
  name: string;
  description: string;
  category: string;
  tags?: string[];
  screenshots?: string[];
  agentPrompts?: string[];
  version?: string;
  author?: string;
  license?: string;
  stats: TemplateCardVO["stats"];
}

interface RawCatalog {
  format?: string;
  repo?: string;
  ref?: string;
  templates?: RawTemplate[];
}

let cache: { at: number; value: TemplateCatalogVO } | null = null;

const catalogUrl = (): string =>
  process.env.BUSABASE_TEMPLATE_CATALOG_URL?.trim() || DEFAULT_CATALOG_URL;

/** `owner/repo` → the tree URL a card links to, and the URL install is given. */
const githubUrls = (repo: string, ref: string, subdir: string) => {
  const base = `https://github.com/${repo}`;
  const path = subdir ? `/tree/${ref}/${subdir}` : `/tree/${ref}`;
  return { sourceUrl: `${base}${path}`, repoUrl: `${base}${path}` };
};

/**
 * Screenshot paths are package-relative in the catalog; the browser needs URLs.
 *
 * Resolved here rather than in the client so a card cannot end up pointing at a
 * different ref than the one its button installs — they are derived from the
 * same two values, once.
 */
const screenshotUrl = (repo: string, ref: string, subdir: string, file: string): string =>
  `https://raw.githubusercontent.com/${repo}/${ref}/${subdir ? `${subdir}/` : ""}${file}`;

const toCard = (raw: RawTemplate, repo: string, ref: string): TemplateCardVO => {
  const { sourceUrl, repoUrl } = githubUrls(repo, ref, raw.subdir);
  return {
    id: `${repo}/${raw.subdir}`,
    name: raw.name,
    description: raw.description,
    category: raw.category,
    tags: raw.tags ?? [],
    screenshots: (raw.screenshots ?? []).map((file) => screenshotUrl(repo, ref, raw.subdir, file)),
    agentPrompts: raw.agentPrompts ?? [],
    ...(raw.version ? { version: raw.version } : {}),
    ...(raw.author ? { author: raw.author } : {}),
    ...(raw.license ? { license: raw.license } : {}),
    stats: raw.stats,
    install: { repoUrl, intoFolder: raw.name },
    sourceUrl,
  };
};

const empty = (error: string): TemplateCatalogVO => ({
  templates: [],
  repo: "",
  ref: "",
  error,
});

export const listTemplates = async (input?: { refresh?: boolean }): Promise<TemplateCatalogVO> => {
  if (!input?.refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const url = catalogUrl();
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch (error) {
    // Surfaced rather than swallowed: an empty gallery and an unreachable
    // catalog look identical to a user, and only one of them is actionable.
    return empty(`Could not reach the template catalog at ${url}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    return empty(`The template catalog at ${url} returned ${response.status}.`);
  }

  let raw: RawCatalog;
  try {
    raw = (await response.json()) as RawCatalog;
  } catch (error) {
    return empty(`The template catalog at ${url} is not valid JSON: ${(error as Error).message}`);
  }

  const repo = raw.repo;
  const ref = raw.ref || "main";
  if (!repo || !Array.isArray(raw.templates)) {
    return empty(`The file at ${url} is not a Busabase template catalog.`);
  }

  const value: TemplateCatalogVO = {
    repo,
    ref,
    templates: raw.templates.map((entry) => toCard(entry, repo, ref)),
  };
  cache = { at: Date.now(), value };
  return value;
};

/** Test seam: drop the cache so a test never inherits another test's answer. */
export const __resetTemplateCatalogCache = (): void => {
  cache = null;
};
