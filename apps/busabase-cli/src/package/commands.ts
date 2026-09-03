/**
 * `install` and `export` — the terminal-facing halves of the `busabase-package@1`
 * format. Thin orchestration: fetch/read → plan → apply, and collect → render → write.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PACKAGE_SKILL_ENTRY,
  TemplateManifestSchema,
} from "busabase-contract/domains/package/template";
import {
  PACKAGE_FORMAT,
  PACKAGE_MANIFEST_FILENAME,
  type PackageManifest,
  PackageManifestSchema,
} from "busabase-contract/domains/package/types";
import { applyInstall } from "busabase-package/apply";
import { collectPackageTree, findSourceNode } from "busabase-package/collect";
import { type DiscoveredPackage, resolvePackageToInstall } from "busabase-package/discover";
import { fetchGithubPackageFiles, type ParsedGithubUrl } from "busabase-package/github";
import { buildTemplateIndex, renderTemplateIndex } from "busabase-package/index-build";
import { readPackageTree } from "busabase-package/layout-read";
import { renderPackageTree, writePackageFiles } from "busabase-package/layout-write";
import {
  assertPlanIsApplicable,
  buildInstallPlan,
  findPlanBlockers,
  renderPlan,
  resolveTargetState,
} from "busabase-package/plan";
import { deriveSkillDraft, validateTemplate } from "busabase-package/template";
import { suggestSlug } from "busabase-package/tree";
import type { BusabaseClient } from "busabase-sdk";

/** Progress is diagnostics, not data — it must never pollute `--output json` on stdout. */
const reportProgress = (message: string): void => {
  console.error(message);
};

export interface InstallCommandOptions {
  intoFolder?: string;
  dryRun?: boolean;
  autoMerge?: boolean;
  rename?: boolean;
  json: boolean;
  githubToken?: string;
  /**
   * Origin of the server being installed into. A host on local-disk storage
   * hands back a root-relative upload url, which only means something to a
   * browser already on that origin — without this the CLI skips every binary
   * (file nodes AND doc images) and installs the package minus its bytes.
   */
  serverUrl?: string;
  /**
   * Which package to install when the URL points at a repository that holds
   * several (`busabase/skills` and its `skills/*`). A name or a subdir.
   */
  skill?: string;
  /**
   * Propose a template's sample rows for review instead of merging them.
   *
   * Off by default because an app whose tables are empty on first open has not
   * delivered what a template promises — but a user installing into a space that
   * already has real data may not want demo rows appearing in it.
   */
  noSampleRecords?: boolean;
  /** Keep what a failed install created instead of moving it to Trash. */
  noRollback?: boolean;
}

/**
 * `install <source>` accepts a GitHub repo URL (unchanged) or, for local
 * package-authoring/testing, a directory on disk or a `file://` URL to one —
 * the exact output `busabase-cli export` writes. `new URL(...)` throws on a
 * bare/relative filesystem path (no scheme), which is what makes a path fall
 * through to "local" here without needing its own flag.
 */
export const isLocalPackageSource = (raw: string): boolean => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return true;
  }
  return url.protocol !== "http:" && url.protocol !== "https:";
};

interface ResolvedPackageSource {
  /** Human-readable origin for progress messages and re-suggested commands. */
  label: string;
  files: Map<string, Buffer>;
  /** Set only for a GitHub source — a local install has no repo/ref to stamp. */
  github?: ParsedGithubUrl;
}

export const resolvePackageSource = async (
  rawSource: string,
  options: { githubToken?: string },
): Promise<ResolvedPackageSource> => {
  if (!isLocalPackageSource(rawSource)) {
    const { source, files } = await fetchGithubPackageFiles(rawSource, {
      githubToken: options.githubToken,
    });
    return { label: `${source.owner}/${source.repo}`, files, github: source };
  }
  const dir = rawSource.trim().startsWith("file://") ? fileURLToPath(rawSource.trim()) : rawSource;
  const files = await readDirectoryFiles(dir);
  if (files.size === 0) {
    throw new Error(
      `No files found under "${dir}". Expected a package directory written by \`busabase-cli export\` (a busabase.json at its root).`,
    );
  }
  return { label: dir, files };
};

export const runInstall = async (
  client: BusabaseClient,
  repoUrl: string,
  options: InstallCommandOptions,
): Promise<unknown> => {
  reportProgress(`Reading ${repoUrl} …`);
  const { label, files, github } = await resolvePackageSource(repoUrl, {
    githubToken: options.githubToken,
  });
  reportProgress(`Loaded ${files.size} file(s) from ${label}.`);

  // The zip extractor already stripped the archive root and the addressed subdir,
  // so a package's manifest sits at the root of what we hold — but the URL may
  // equally point at a repository that CONTAINS packages rather than being one.
  const resolved = resolvePackageToInstall(files, options.skill);
  if (resolved.kind === "none") {
    // Let the reader raise its own error: it explains what was expected and
    // where, which is more useful than anything restated here.
    readPackageTree(files);
    throw new Error("Not a Busabase package.");
  }
  if (resolved.kind === "choose") {
    const report = renderPackageChoices(repoUrl, resolved.candidates, options.skill);
    if (options.json) {
      return { chooseOne: true, candidates: resolved.candidates.map(toCandidateSummary) };
    }
    return report;
  }
  const tree = readPackageTree(files, resolved.subdir ? { root: resolved.subdir } : {});
  if (resolved.subdir) {
    reportProgress(`Installing "${resolved.discovered.name}" from ${resolved.subdir}/ …`);
  }

  // Slugify to match what `buildInstallPlan` will actually target — a manifest
  // name is free-form, a slug is not. Looking the existing folder up by the raw
  // name resolves collisions against a folder the install never touches.
  const targetFolderSlug = options.intoFolder ?? suggestSlug(tree.manifest.name);
  const plan = buildInstallPlan(tree, await resolveTargetState(client, targetFolderSlug), {
    intoFolder: options.intoFolder,
    rename: options.rename,
    installSampleRecords: !options.noSampleRecords,
  });

  if (options.dryRun) {
    // Run the SAME checks a real install runs, and report them instead of
    // throwing — a dry run's whole job is to say what would happen. It used to
    // return before `assertPlanIsApplicable` ran at all, so it printed a
    // clean-looking plan for packages that could not install: name collisions,
    // a missing `--auto-merge`, and required fields the package cannot fill
    // all went unmentioned until the real run hit them (the last of those only
    // once the server was already writing records).
    const blockers = findPlanBlockers(plan, Boolean(options.autoMerge));
    const verdict =
      blockers.length === 0
        ? "Dry run — nothing was created. No blockers found."
        : `Dry run — nothing was created.\n\nThis package would NOT install as-is:\n\n${blockers.join("\n\n")}`;
    const report = `${renderPlan(plan)}\n\n${verdict}`;
    return options.json ? { dryRun: true, blockers, ...toPlanSummary(plan) } : report;
  }

  assertPlanIsApplicable(plan, Boolean(options.autoMerge));

  const result = await applyInstall(client, plan, {
    autoMerge: Boolean(options.autoMerge),
    submittedBy: `busabase-cli install (${tree.manifest.name})`,
    onProgress: reportProgress,
    serverUrl: options.serverUrl,
    installSampleRecords: !options.noSampleRecords,
    rollbackOnFailure: !options.noRollback,
    source: {
      ...(github ? { repo: `${github.owner}/${github.repo}`, ref: github.ref } : {}),
      ...(resolved.subdir
        ? { subdir: resolved.subdir }
        : github?.subdir
          ? { subdir: github.subdir }
          : {}),
    },
  });

  if (options.json) return { installed: true, ...result };
  return renderInstallReport(plan.targetFolderSlug, result);
};

const toCandidateSummary = (candidate: DiscoveredPackage) => ({
  name: candidate.name,
  subdir: candidate.subdir,
  description: candidate.description,
  isTemplate: candidate.isTemplate,
  counts: candidate.counts,
});

/**
 * The list a user sees when their URL pointed at a repository of packages.
 *
 * Templates are listed first and labelled, because that is the difference the
 * user actually cares about: one installs an app, the other installs tables. A
 * package that TRIED to be a template and failed says so with its reasons —
 * that reader is usually its author.
 */
const renderPackageChoices = (
  repoUrl: string,
  candidates: DiscoveredPackage[],
  wanted: string | undefined,
): string => {
  const lines: string[] = [];
  if (wanted) {
    lines.push(`No package named "${wanted}" in ${repoUrl}. It contains:`);
  } else {
    lines.push(`${repoUrl} contains ${candidates.length} packages. Pick one:`);
  }
  lines.push("");
  const ordered = [...candidates].sort((a, b) => {
    if (a.isTemplate !== b.isTemplate) return a.isTemplate ? -1 : 1;
    return a.name.localeCompare(b.name, "en");
  });
  for (const candidate of ordered) {
    const shape = [
      candidate.isTemplate ? "template" : "package",
      candidate.counts.bases > 0 ? `${candidate.counts.bases} base(s)` : undefined,
      candidate.primaryAirApp ? "app" : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(`  ${candidate.name}  (${shape})`);
    if (candidate.description) lines.push(`    ${candidate.description}`);
    for (const error of candidate.templateErrors) {
      lines.push(`    not a template: ${error}`);
    }
  }
  lines.push("");
  lines.push("Install one with:");
  lines.push(`  busabase-cli install ${repoUrl} --skill ${ordered[0]?.name ?? "<name>"}`);
  return lines.join("\n");
};

const toPlanSummary = (plan: ReturnType<typeof buildInstallPlan>) => ({
  targetFolder: plan.targetFolderSlug,
  package: plan.tree.manifest.name,
  counts: plan.counts,
  collisions: plan.collisions,
  warnings: plan.warnings,
  requiresAutoMerge: plan.requiresAutoMerge,
});

const renderInstallReport = (
  targetFolderSlug: string,
  result: Awaited<ReturnType<typeof applyInstall>>,
): string => {
  const lines: string[] = [];
  lines.push(`Installed into folder "${targetFolderSlug}".`);
  lines.push("");
  lines.push("Created:");
  for (const [label, count] of Object.entries(result.created)) {
    if (count > 0) lines.push(`  ${count} ${label}`);
  }
  if (result.pendingChangeRequests > 0) {
    lines.push("");
    lines.push(
      `${result.pendingChangeRequests} change request(s) are pending your review — nothing is live until you merge them:`,
    );
    lines.push("  busabase-cli change-requests list");
  }
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings) lines.push(`  • ${warning}`);
  }
  return lines.join("\n");
};

export interface ExportCommandOptions {
  outDir: string;
  name?: string;
  dryRun?: boolean;
  /**
   * Export as a template: check it against the template rules and, when the
   * folder has no Skill node yet, write a SKILL.md draft beside the manifest.
   *
   * The draft is the point. Without it, "make my folder a template" means
   * hand-writing a file whose format the author has to look up first — and the
   * most likely outcome of that is no manual at all, which is the one thing a
   * template cannot be missing.
   */
  template?: boolean;
  json: boolean;
  /** Host to resolve a local server's root-relative asset urls against — see CollectOptions.baseUrl. */
  baseUrl: string;
}

export const runExport = async (
  client: BusabaseClient,
  nodeSlugOrId: string,
  options: ExportCommandOptions,
): Promise<unknown> => {
  const nodes = await client.nodes.list();
  const source = findSourceNode(nodes as never, nodeSlugOrId);

  const warnings: string[] = [];
  const manifest = await resolveManifest(options.outDir, options.name, source.name, source.slug);
  reportProgress(`Reading "${source.slug}" …`);
  const tree = await collectPackageTree(client, source as never, {
    manifest,
    warn: (message) => warnings.push(message),
    baseUrl: options.baseUrl,
  });

  if (options.template) {
    if (!tree.rootSkill) {
      warnings.push(
        `No Skill node in "${source.slug}", so a ${PACKAGE_SKILL_ENTRY} draft was written from the folder's structure. Fill in its TODOs before publishing — an agent acts on what it says.`,
      );
      tree.rootSkill = {
        slug: manifest.name,
        name: manifest.name,
        description: manifest.description,
        files: [{ path: PACKAGE_SKILL_ENTRY, bytes: Buffer.from(deriveSkillDraft(tree), "utf8") }],
      };
    }
    if (!tree.manifest.template) {
      // The manifest half of the opt-in. Written with a placeholder category
      // rather than guessed, because the category is what a browsing user filters
      // on and a wrong one is worse than an obvious blank.
      tree.manifest = {
        ...tree.manifest,
        template: TemplateManifestSchema.parse({ category: "uncategorized" }),
      };
    }
    const validation = validateTemplate(tree);
    for (const warning of validation.warnings) warnings.push(warning);
    for (const error of validation.errors) warnings.push(`Not yet a valid template: ${error}`);
  }

  const files = renderPackageTree(tree);
  if (!options.dryRun) {
    // Clean first: a re-export must not leave a deleted node's files behind, or the
    // git diff would stop reflecting the space.
    await writePackageFiles(files, options.outDir, { clean: true });
  }

  if (options.json) {
    return {
      exported: !options.dryRun,
      package: manifest.name,
      outDir: options.outDir,
      files: [...files.keys()].sort(),
      ...(options.template ? { isTemplate: validateTemplate(tree).ok } : {}),
      warnings,
    };
  }
  return renderExportReport(options, manifest, files, warnings);
};

/**
 * Reuse an existing `busabase.json` so a re-export preserves the author's metadata
 * (version, license, tags) instead of resetting it. `--name` wins; otherwise fall back
 * to the node's own name.
 */
const resolveManifest = async (
  outDir: string,
  nameFlag: string | undefined,
  nodeName: string,
  nodeSlug: string,
): Promise<PackageManifest> => {
  const existing = await readExistingManifest(outDir);
  if (existing) {
    return { ...existing, name: nameFlag ?? existing.name };
  }
  return PackageManifestSchema.parse({
    format: PACKAGE_FORMAT,
    name: nameFlag ?? nodeSlug,
    description: nodeName === nodeSlug ? "" : nodeName,
  });
};

const readExistingManifest = async (outDir: string): Promise<PackageManifest | undefined> => {
  try {
    const raw = await readFile(join(outDir, PACKAGE_MANIFEST_FILENAME), "utf8");
    const parsed = PackageManifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const renderExportReport = (
  options: ExportCommandOptions,
  manifest: PackageManifest,
  files: Map<string, Buffer>,
  warnings: string[],
): string => {
  const lines: string[] = [];
  lines.push(
    options.dryRun
      ? `Dry run — would write ${files.size} file(s) to ${options.outDir}:`
      : `Wrote ${files.size} file(s) to ${options.outDir}:`,
  );
  for (const filePath of [...files.keys()].sort()) lines.push(`  ${filePath}`);
  if (warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of warnings) lines.push(`  • ${warning}`);
  }
  if (!options.dryRun) {
    lines.push("");
    lines.push("Now push it to GitHub:");
    lines.push(`  cd ${options.outDir}`);
    lines.push(
      '  git init && git add . && git commit -m "Add ${name} package"'.replace(
        "${name}",
        manifest.name,
      ),
    );
    lines.push(
      "  git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main",
    );
    lines.push("");
    lines.push("Then anyone can install it:");
    lines.push("  busabase-cli install https://github.com/<you>/<repo>");
  }
  return lines.join("\n");
};

// ── index ────────────────────────────────────────────────────────────────────

export interface IndexCommandOptions {
  /** Directory to scan — a checkout of the skills repository. */
  dir: string;
  /** `owner/repo` the entries' subdirs are relative to. */
  repo: string;
  ref: string;
  /** Where to write. Omit to print. */
  out?: string;
  /** Exit non-zero if the file on disk is not what would be written. */
  check?: boolean;
  json: boolean;
}

/**
 * Build the Template Center's catalog from a checkout.
 *
 * Lives here rather than in the skills repository so the catalog and the
 * installer share one answer to "is this a template". A repository that decided
 * for itself could list a card whose install then behaves differently — which
 * is a trust problem, not a formatting one.
 */
export const runIndex = async (options: IndexCommandOptions): Promise<unknown> => {
  const files = await readDirectoryFiles(options.dir);
  const index = buildTemplateIndex(files, { repo: options.repo, ref: options.ref });
  const rendered = renderTemplateIndex(index);

  if (options.check) {
    if (!options.out) throw new Error("--check needs --out: there is nothing to compare against.");
    const current = await readFile(options.out, "utf8").catch(() => null);
    if (current !== rendered) {
      throw new Error(
        `${options.out} is out of date. Run the same command without --check to rebuild it.`,
      );
    }
    return options.json
      ? { upToDate: true, templates: index.templates.length }
      : `${options.out} is up to date (${index.templates.length} template(s)).`;
  }

  if (options.out) {
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, rendered);
  }

  if (options.json) return index;
  if (!options.out) return rendered.trimEnd();

  const lines = [`Wrote ${options.out}: ${index.templates.length} template(s).`];
  for (const entry of index.templates) {
    lines.push(`  ${entry.name}  (${entry.category} · ${entry.stats.bases} base(s))`);
  }
  if (index.rejected.length > 0) {
    // Named, not silently omitted: the reader most likely to care is the author
    // of the entry that is missing.
    lines.push("", "Declared a template but did not qualify:");
    for (const entry of index.rejected) {
      lines.push(`  ${entry.name}`);
      for (const error of entry.errors) lines.push(`    ${error}`);
    }
  }
  return lines.join("\n");
};

/** Every file under `dir`, keyed by its POSIX path relative to it. */
const readDirectoryFiles = async (dir: string): Promise<Map<string, Buffer>> => {
  const files = new Map<string, Buffer>();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      // Skipped for the same reason discovery caps its depth: a vendored copy
      // is not a product this repository publishes.
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const absolute = join(current, entry.name);
      // `stat`, not the dirent: a symlink reports as neither file nor
      // directory, and this repository uses them to share one skill between
      // several client layouts. Reading a linked directory as a file threw.
      const info = await stat(absolute).catch(() => null);
      if (!info) continue; // dangling link
      if (info.isDirectory()) await walk(absolute);
      else if (info.isFile()) {
        files.set(relative(dir, absolute).split(sep).join("/"), await readFile(absolute));
      }
    }
  };
  await walk(dir);
  return files;
};
