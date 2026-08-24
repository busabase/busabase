/**
 * Build the Template Center's catalog from a directory of skills.
 *
 * The catalog is not hand-maintained. A card that says "6 tables" for a package
 * that installs five is a trust bug, not a typo — so every field here is read
 * off the package itself, and whether an entry appears at all is decided by the
 * SAME `validateTemplate` the installer uses. A skill that would install as a
 * plain package can never be listed as a template, because one function answers
 * that question for both.
 *
 * Deliberately a plain function over a file map rather than something that
 * walks a disk: the CLI hands it a checkout, and a future CI job could hand it
 * a fetched zipball, without either needing its own notion of what counts.
 *
 * Spec: `apps/busabase/content/spec/template-center.md` §6.4.
 */
import { type DiscoveredPackage, discoverPackages } from "./discover";
import type { PackageFiles } from "./layout-read";

/** Bumped when a consumer would misread an older file. */
export const TEMPLATE_INDEX_FORMAT = "busabase-template-index@1";

export interface TemplateIndexEntry {
  /** Install target: `<repo>` + this subdir is the URL a card's button uses. */
  subdir: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  /** Package-relative paths; a consumer resolves them against the repo. */
  screenshots: string[];
  /** Ready-made prompts an installed app suggests. */
  agentPrompts: string[];
  version?: string;
  author?: string;
  license?: string;
  /** What installing it creates — the card's "6 tables · 1 app" line. */
  stats: {
    folders: number;
    docs: number;
    bases: number;
    records: number;
    files: number;
    airapps: number;
    /** Templates always ship one; kept explicit so a consumer need not assume. */
    skill: boolean;
  };
}

export interface TemplateIndex {
  format: typeof TEMPLATE_INDEX_FORMAT;
  /** `owner/repo` the entries' subdirs are relative to. */
  repo: string;
  /** Git ref the entries were read at — the version a card installs. */
  ref: string;
  templates: TemplateIndexEntry[];
  /**
   * Packages that declared themselves templates and did not qualify, with the
   * reasons.
   *
   * Published rather than dropped silently: the person most likely to read this
   * file is the author of the entry that is missing from it, and "your skill is
   * not in the catalog" without a reason is the least actionable message a
   * build can produce.
   */
  rejected: { subdir: string; name: string; errors: string[] }[];
}

const toEntry = (found: DiscoveredPackage, airapps: number): TemplateIndexEntry => ({
  subdir: found.subdir,
  name: found.name,
  description: found.description,
  category: found.category ?? "uncategorized",
  tags: found.tags ?? [],
  screenshots: found.screenshots,
  agentPrompts: found.agentPrompts ?? [],
  ...(found.version ? { version: found.version } : {}),
  ...(found.author ? { author: found.author } : {}),
  ...(found.license ? { license: found.license } : {}),
  stats: {
    folders: found.counts.folders,
    docs: found.counts.docs,
    bases: found.counts.bases,
    records: found.counts.records,
    files: found.counts.files,
    airapps,
    skill: true,
  },
});

export interface BuildTemplateIndexOptions {
  repo: string;
  ref: string;
}

export const buildTemplateIndex = (
  files: PackageFiles,
  options: BuildTemplateIndexOptions,
): TemplateIndex => {
  const discovered = discoverPackages(files);
  const templates: TemplateIndexEntry[] = [];
  const rejected: TemplateIndex["rejected"] = [];

  for (const found of discovered) {
    if (found.isTemplate) {
      templates.push(toEntry(found, found.primaryAirApp ? 1 : 0));
      continue;
    }
    // A package that never claimed to be a template is not a rejection — it is
    // simply a package, and listing it as a failure would tell its author to
    // fix something they never asked for.
    if (found.templateErrors.length > 0) {
      rejected.push({ subdir: found.subdir, name: found.name, errors: found.templateErrors });
    }
  }

  return {
    format: TEMPLATE_INDEX_FORMAT,
    repo: options.repo,
    ref: options.ref,
    // Sorted by name so a rebuild produces a byte-identical file when nothing
    // changed — the same reason `export` is deterministic. A catalog whose diff
    // is noise stops being reviewed.
    templates: templates.sort((a, b) => a.name.localeCompare(b.name, "en")),
    rejected: rejected.sort((a, b) => a.name.localeCompare(b.name, "en")),
  };
};

export const renderTemplateIndex = (index: TemplateIndex): string =>
  `${JSON.stringify(index, null, 2)}\n`;
