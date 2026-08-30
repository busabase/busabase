/**
 * `busabase-cli check <dir>` — one command, four layers.
 *
 * Four things can be true of one directory, and they are not four rungs of a ladder:
 * a **package** installs resources into a workspace, an **Agent Skill** is a manual an
 * agent reads, a **template** is a directory that is both plus an explicit opt-in, and
 * an **AirApp** is a node type that ships inside a package. Most real directories are
 * several of these at once.
 *
 * That is exactly why this is one command rather than three. Running the wrong checker
 * is the usual way an author ends up believing they are covered when they are not, and
 * three commands would institutionalise that mistake by requiring the author to answer
 * "which am I?" correctly first. Detection is reliable because the formats carry their
 * own declarations: `busabase.json` makes it a package, a parseable `SKILL.md` makes it
 * a Skill, `metadata.busabase.template: true` makes it a template, and an
 * `_node.json` of type `airapp` makes it an app.
 *
 * A layer that does not apply reports `–`, never `✓`. Keeping those visually distinct
 * is the whole point: "not applicable" and "passed" look identical in a checklist that
 * only has ticks, and that is how coverage gets assumed rather than verified.
 *
 * The rules themselves live where they are versioned with what they check —
 * `busabase-package/audit` and `validateTemplate` for the format, `busabase-sdk/airapp-check`
 * for the runtime contract. This file composes; it owns no rules of its own.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import { type AuditFinding, auditPackage, auditSkill } from "busabase-package/audit";
import { type PackageFiles, readPackageTree } from "busabase-package/layout-read";
import { validateTemplate } from "busabase-package/template";
import type { PackageTree } from "busabase-package/tree";
import { type AirAppSources, checkAirApp } from "busabase-sdk/airapp-check";

export const CHECK_LAYERS = ["package", "skill", "template", "airapp"] as const;
export type CheckLayer = (typeof CHECK_LAYERS)[number];

export interface LayerReport {
  layer: CheckLayer;
  /** `false` when the directory is not this kind of thing — reported as `–`, never `✓`. */
  applicable: boolean;
  /** What the layer applies to, when there can be more than one (an AirApp slug). */
  subject?: string;
  /** Why a layer was skipped, or a one-line note when it passed. */
  note?: string;
  findings: AuditFinding[];
}

export interface CheckResult {
  name: string;
  layers: LayerReport[];
  errors: number;
  warnings: number;
  ok: boolean;
}

export interface CheckCommandOptions {
  /** Warnings fail too. The right default for CI on a shared catalog. */
  strict?: boolean;
  /**
   * Judge the directory as this layer even if it has not declared itself one.
   *
   * The single thing detection cannot recover: intent. Everything else is on disk,
   * but "I am building toward a template and have not added the opt-in yet" is not.
   */
  as?: CheckLayer;
  /** Report only this layer. Its exit code then ignores the others. */
  only?: CheckLayer;
  json: boolean;
}

/** Every file under `dir`, keyed by POSIX path relative to it. */
const readDirectoryFiles = async (dir: string): Promise<PackageFiles> => {
  const files: PackageFiles = new Map();
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      // A vendored copy is not something this directory publishes, and `.git` holds
      // object blobs that would be scanned as if they were source.
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const absolute = join(current, entry.name);
      // `stat`, not the dirent: a symlink reports as neither, and skill repositories
      // use them to share one directory between several client layouts.
      const info = await stat(absolute).catch(() => null);
      if (!info) continue;
      if (info.isDirectory()) await walk(absolute);
      else if (info.isFile()) {
        files.set(relative(dir, absolute).split(sep).join("/"), await readFile(absolute));
      }
    }
  };
  await walk(dir);
  return files;
};

const text = (bytes: Buffer | undefined): string | undefined => bytes?.toString("utf8");

/**
 * Assemble one AirApp's sources the way `checkAirApp` documents they must be assembled.
 *
 * Both traps here were hit for real against shipped apps before this collector existed:
 *
 * - **The server is the whole subtree.** A `server.js` that mounts `server/hono.ts` keeps
 *   the runtime route in the module, so reading only the entry reported two correct apps
 *   as missing it entirely.
 * - **`app/vendor/` is excluded.** A bundled `busabase-sdk` legitimately builds an
 *   `Authorization: Bearer …` header, so sweeping it in reports every app that bundles
 *   the SDK as leaking a credential.
 *
 * The logic/downloads split is inherited from the scaffold's own gate and is equally
 * load-bearing: structural rules run over the app's logic files only, because an
 * asset-path or hostname rule false-positives on UI copy; credentials are scanned over
 * everything the browser receives, because a key in a string table ships just the same.
 */
const airAppSources = (
  files: readonly { path: string; bytes: Buffer }[],
  slug: string,
): AirAppSources => {
  const at = (path: string) => files.find((file) => file.path === path)?.bytes;
  const join_ = (predicate: (path: string) => boolean) =>
    files
      .filter((file) => predicate(file.path))
      .map((file) => file.bytes.toString("utf8"))
      .join("\n");

  const isVendor = (path: string) => path.startsWith("app/vendor/");
  const isLogic = (path: string) =>
    !isVendor(path) &&
    (/^app\/js\/(?:app|config|busabase-client|runtime)\.[jt]s$/.test(path) ||
      /^app\/js\/providers\/busabase-provider\.[jt]s$/.test(path) ||
      /^lib\/.*\.[jt]s$/.test(path));
  const isDownload = (path: string) =>
    !isVendor(path) && (path === "app/index.html" || /^app\/(?:js|i18n)\/.*\.[jt]s$/.test(path));
  const isServer = (path: string) =>
    path === "server.js" || path === "server.py" || /^server\//.test(path);

  const server = join_(isServer);
  return {
    packageJson: text(at("package.json")),
    ...(server ? { server } : {}),
    serverLanguage: files.some((file) => file.path === "server.py") ? "python" : "node",
    browserLogic: join_(isLogic),
    browserDownloads: join_(isDownload),
    ...(text(at("app/js/config.js")) !== undefined ? { config: text(at("app/js/config.js")) } : {}),
    shippedSlug: slug,
  };
};

const airApps = (
  tree: PackageTree,
): { slug: string; files: { path: string; bytes: Buffer }[] }[] => {
  const found: { slug: string; files: { path: string; bytes: Buffer }[] }[] = [];
  const visit = (nodes: PackageTree["nodes"]): void => {
    for (const node of nodes) {
      if (node.type === "airapp") found.push({ slug: node.slug, files: node.files });
      else if (node.type === "folder") visit(node.children);
    }
  };
  visit(tree.nodes);
  return found;
};

/** Run every applicable layer over one directory. */
export const checkDirectory = async (
  dir: string,
  options: Pick<CheckCommandOptions, "as" | "only"> = {},
): Promise<CheckResult> => {
  const root = resolve(dir);
  const name = basename(root);
  const files = await readDirectoryFiles(root);
  const layers: LayerReport[] = [];
  const wanted = (layer: CheckLayer) => options.only === undefined || options.only === layer;

  const skip = (layer: CheckLayer, note: string) => {
    if (wanted(layer)) layers.push({ layer, applicable: false, note, findings: [] });
  };

  if (!files.has("busabase.json")) {
    // Without a manifest there is no tree to read, so every layer that needs one is
    // out. A directory holding only a SKILL.md is a perfectly ordinary Agent Skill.
    skip("package", "no busabase.json");
    skip("template", "not a package");
    skip("airapp", "not a package");
    if (wanted("skill")) {
      layers.push(
        files.has("SKILL.md")
          ? {
              layer: "skill",
              applicable: true,
              note: "standalone Agent Skill",
              findings: auditSkill(files),
            }
          : { layer: "skill", applicable: false, note: "no SKILL.md", findings: [] },
      );
    }
    return summarise(name, layers, options);
  }

  let tree: PackageTree;
  try {
    tree = readPackageTree(files);
  } catch (cause) {
    return summarise(
      name,
      [
        {
          layer: "package",
          applicable: true,
          findings: [
            {
              severity: "error",
              rule: "package/unreadable",
              message: (cause as Error).message,
            },
          ],
        },
      ],
      options,
    );
  }

  if (wanted("package")) {
    layers.push({
      layer: "package",
      applicable: true,
      findings: auditPackage(tree, files, { directoryName: name }),
    });
  }

  if (wanted("skill")) {
    if (tree.rootSkill === undefined && options.as !== "skill") {
      skip("skill", "no root SKILL.md");
    } else {
      layers.push({ layer: "skill", applicable: true, findings: auditSkill(files) });
    }
  }

  if (wanted("template")) {
    const declared = tree.rootSkill !== undefined;
    if (!declared && options.as !== "template") {
      skip("template", "no root SKILL.md");
    } else {
      const validation = validateTemplate(tree);
      layers.push({
        layer: "template",
        applicable: true,
        note: validation.ok ? "declared, qualifies" : undefined,
        findings: [
          ...validation.errors.map((message) => ({
            severity: "error" as const,
            rule: "template/invalid",
            message,
          })),
          ...validation.warnings.map((message) => ({
            severity: "warning" as const,
            rule: "template/incomplete",
            message,
          })),
        ],
      });
    }
  }

  if (wanted("airapp")) {
    const apps = airApps(tree);
    if (apps.length === 0) {
      skip("airapp", "no AirApp under content/");
    } else {
      for (const app of apps) {
        layers.push({
          layer: "airapp",
          applicable: true,
          subject: app.slug,
          findings: checkAirApp(airAppSources(app.files, app.slug)),
        });
      }
    }
  }

  return summarise(name, layers, options);
};

const summarise = (
  name: string,
  layers: LayerReport[],
  _options: Pick<CheckCommandOptions, "as" | "only">,
): CheckResult => {
  // Reported in a fixed order, never the order the checks happened to run in — a
  // reader comparing two directories should not have to re-find each layer.
  layers.sort(
    (left, right) => CHECK_LAYERS.indexOf(left.layer) - CHECK_LAYERS.indexOf(right.layer),
  );
  let errors = 0;
  let warnings = 0;
  for (const layer of layers) {
    for (const finding of layer.findings) {
      if (finding.severity === "error") errors += 1;
      else warnings += 1;
    }
  }
  return { name, layers, errors, warnings, ok: errors === 0 };
};

const LAYER_WIDTH = Math.max(...CHECK_LAYERS.map((layer) => layer.length));

export const formatCheck = (results: CheckResult[], strict: boolean): string => {
  const lines: string[] = [];
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    errors += result.errors;
    warnings += result.warnings;
    lines.push(result.name);
    for (const layer of result.layers) {
      const label = layer.layer.padEnd(LAYER_WIDTH);
      if (!layer.applicable) {
        lines.push(`  ${label} –     ${layer.note ?? ""}`.trimEnd());
        continue;
      }
      const bad = layer.findings.filter((finding) => finding.severity === "error").length;
      const soft = layer.findings.length - bad;
      const mark = bad > 0 ? "✗" : soft > 0 ? "!" : "✓";
      const counts = [
        bad > 0 ? `${bad} error${bad === 1 ? "" : "s"}` : "",
        soft > 0 ? `${soft} warning${soft === 1 ? "" : "s"}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `  ${label} ${mark}     ${[counts, layer.subject, layer.note].filter(Boolean).join("  ")}`.trimEnd(),
      );
      for (const finding of layer.findings) {
        lines.push(
          `     ${finding.severity === "error" ? "✗" : "!"} [${finding.rule}] ${finding.message}`,
        );
      }
    }
    lines.push("");
  }
  lines.push(
    `${results.length} directory(ies): ${errors} error(s), ${warnings} warning(s)${
      strict ? " (--strict: warnings fail)" : ""
    }.`,
  );
  return lines.join("\n");
};

/**
 * A repository of templates is anything with a `templates/` directory; every entry under
 * it is checked. Otherwise the argument is one directory.
 */
const resolveTargets = async (dir: string): Promise<string[]> => {
  const root = resolve(dir);
  const templates = join(root, "templates");
  if (
    await stat(templates).then(
      () => true,
      () => false,
    )
  ) {
    const entries = await readdir(templates, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(templates, entry.name));
  }
  return [root];
};

export const runCheck = async (dir: string, options: CheckCommandOptions): Promise<unknown> => {
  const targets = await resolveTargets(dir);
  const results: CheckResult[] = [];
  for (const target of targets) results.push(await checkDirectory(target, options));

  const errors = results.reduce((total, result) => total + result.errors, 0);
  const warnings = results.reduce((total, result) => total + result.warnings, 0);
  const ok = errors === 0 && (!options.strict || warnings === 0);
  if (!ok) process.exitCode = 1;
  return options.json ? { ok, results } : formatCheck(results, Boolean(options.strict));
};
