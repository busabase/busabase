/**
 * `install` and `publish` — the terminal-facing halves of the `busabase-package@1`
 * format. Thin orchestration: fetch/read → plan → apply, and collect → render → write.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PACKAGE_FORMAT,
  PACKAGE_MANIFEST_FILENAME,
  type PackageManifest,
  PackageManifestSchema,
} from "busabase-contract/domains/package/types";
import type { BusabaseClient } from "busabase-sdk";
import { applyInstall } from "./apply.js";
import { collectPackageTree, findSourceNode } from "./collect.js";
import { fetchGithubPackageFiles } from "./github.js";
import { readPackageTree } from "./layout-read.js";
import { renderPackageTree, writePackageFiles } from "./layout-write.js";
import { assertPlanIsApplicable, buildInstallPlan, type ExistingNode, renderPlan } from "./plan.js";

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
}

export const runInstall = async (
  client: BusabaseClient,
  repoUrl: string,
  options: InstallCommandOptions,
): Promise<unknown> => {
  reportProgress(`Fetching ${repoUrl} …`);
  const { source, files } = await fetchGithubPackageFiles(repoUrl, {
    githubToken: options.githubToken,
  });
  reportProgress(`Downloaded ${files.size} file(s) from ${source.owner}/${source.repo}.`);

  // The zip extractor already stripped the archive root and the addressed subdir, so
  // the manifest sits at the root of what we hold.
  const tree = readPackageTree(files);

  const [nodes, bases] = await Promise.all([client.nodes.list(), client.bases.list()]);
  const targetFolderSlug = options.intoFolder ?? tree.manifest.name;
  const plan = buildInstallPlan(
    tree,
    {
      targetFolder: findTargetFolder(nodes as unknown as ExistingNode[], targetFolderSlug),
      existingBaseSlugs: new Set(bases.map((base) => base.slug)),
    },
    { intoFolder: options.intoFolder, rename: options.rename },
  );

  if (options.dryRun) {
    const report = `${renderPlan(plan)}\n\nDry run — nothing was created.`;
    return options.json ? { dryRun: true, ...toPlanSummary(plan) } : report;
  }

  assertPlanIsApplicable(plan, Boolean(options.autoMerge));

  const result = await applyInstall(client, plan, {
    autoMerge: Boolean(options.autoMerge),
    submittedBy: `busabase-cli install (${tree.manifest.name})`,
    onProgress: reportProgress,
  });

  if (options.json) return { installed: true, ...result };
  return renderInstallReport(plan.targetFolderSlug, result);
};

/** The target folder is addressed by slug at the space root. */
const findTargetFolder = (
  nodes: readonly ExistingNode[],
  slug: string,
): ExistingNode | undefined => {
  // `nodes.list()` returns the root wrapper as a single element; the package's target
  // folder is a child of the root, or a root-level node itself.
  const roots = nodes.length === 1 && nodes[0].children ? nodes[0].children : nodes;
  return roots.find((node) => node.slug === slug && node.type === "folder");
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

export interface PublishCommandOptions {
  outDir: string;
  name?: string;
  dryRun?: boolean;
  json: boolean;
  /** Host to resolve a local server's root-relative asset urls against — see CollectOptions.baseUrl. */
  baseUrl: string;
}

export const runPublish = async (
  client: BusabaseClient,
  nodeSlugOrId: string,
  options: PublishCommandOptions,
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

  const files = renderPackageTree(tree);
  if (!options.dryRun) {
    // Clean first: a re-publish must not leave a deleted node's files behind, or the
    // git diff would stop reflecting the space.
    await writePackageFiles(files, options.outDir, { clean: true });
  }

  if (options.json) {
    return {
      published: !options.dryRun,
      package: manifest.name,
      outDir: options.outDir,
      files: [...files.keys()].sort(),
      warnings,
    };
  }
  return renderPublishReport(options, manifest, files, warnings);
};

/**
 * Reuse an existing `busabase.json` so a re-publish preserves the author's metadata
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

const renderPublishReport = (
  options: PublishCommandOptions,
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
    lines.push("Now publish it to GitHub:");
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
