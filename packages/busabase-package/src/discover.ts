/**
 * What is at the end of this URL — one package, one template, or a repository
 * full of them?
 *
 * A user pasting a GitHub URL does not think in terms of "package roots". They
 * paste the repo they were looking at. Sometimes that repo IS the package;
 * sometimes it is `busabase/skills`, which holds dozens under `skills/*`. Before
 * this, the second case was only ever an error message with a list of
 * subdirectories to paste instead — correct, and a dead end for anyone who did
 * not want to edit a URL by hand.
 *
 * Discovery answers it once for every caller: the CLI turns the result into a
 * pick-one list, the dashboard's install dialog into a chooser, the Template
 * Center's index CI into the set of cards to publish. All three must agree on
 * what counts as a template, which is why the verdict comes from the same
 * `validateTemplate` they would each otherwise re-implement.
 *
 * Spec: `apps/busabase/content/spec/template-center.md` §6.2a.
 */
import { PACKAGE_MANIFEST_FILENAME } from "busabase-contract/domains/package/types";
import { type PackageFiles, readPackageTree } from "./layout-read";
import { countTree, type PlanCounts } from "./plan";
import { validateTemplate } from "./template";

export interface DiscoveredPackage {
  /** Path from the URL's root; `""` when the repo itself is the package. */
  subdir: string;
  name: string;
  description: string;
  /** Installs as an app: Skill node, ownership stamps, sample rows merged. */
  isTemplate: boolean;
  /**
   * Why it is not a template, when it declares itself as one but fails.
   *
   * Empty for a package that never claimed to be one — "a plain package" is not
   * a defect and must not be reported as a list of problems. Populated only when
   * the author asked for something they did not quite get, which is exactly when
   * they need to be told.
   */
  templateErrors: string[];
  counts: PlanCounts;
  /** Which AirApp "open the app" means, when it has one. */
  primaryAirApp?: string;
  category?: string;
  screenshots: string[];
  /** Manifest tags merged with the template's own — what a catalog filters on. */
  tags: string[];
  agentPrompts: string[];
  version?: string;
  author?: string;
  license?: string;
}

/**
 * Only one level deep, matching the `skills/<name>/` layout the skills CLI
 * already established and the Template Center reads. Walking arbitrarily deep
 * would turn one paste into an unbounded scan of a monorepo and surface vendored
 * copies inside `node_modules` as installable products.
 */
const MAX_DISCOVERY_DEPTH = 2;

/** Cap on how many are examined, so a huge repo cannot make one paste expensive. */
export const MAX_DISCOVERED_PACKAGES = 200;

const manifestDirectories = (files: PackageFiles): string[] => {
  const dirs = new Set<string>();
  for (const filePath of files.keys()) {
    if (filePath === PACKAGE_MANIFEST_FILENAME) {
      dirs.add("");
      continue;
    }
    if (!filePath.endsWith(`/${PACKAGE_MANIFEST_FILENAME}`)) continue;
    const dir = filePath.slice(0, -PACKAGE_MANIFEST_FILENAME.length - 1);
    if (dir.split("/").length > MAX_DISCOVERY_DEPTH) continue;
    dirs.add(dir);
  }
  return [...dirs].sort((a, b) => a.localeCompare(b, "en"));
};

/**
 * Every package at or below the fetched root, root first.
 *
 * A directory whose manifest or content does not parse is SKIPPED rather than
 * failing the whole discovery: one malformed skill in a repository of fifty must
 * not make the other forty-nine unreachable. The user is choosing from a list,
 * and an entry that cannot be read has nothing to offer that list.
 */
export const discoverPackages = (files: PackageFiles): DiscoveredPackage[] => {
  const found: DiscoveredPackage[] = [];
  for (const subdir of manifestDirectories(files)) {
    if (found.length >= MAX_DISCOVERED_PACKAGES) break;
    let tree: ReturnType<typeof readPackageTree>;
    try {
      tree = readPackageTree(files, subdir ? { root: subdir } : {});
    } catch {
      continue;
    }
    const validation = validateTemplate(tree);
    // A package that never opted in is not "failing" — see `templateErrors`.
    const claimsTemplate = Boolean(tree.rootSkill) || Boolean(tree.manifest.template);
    found.push({
      subdir,
      name: tree.manifest.name,
      description: tree.manifest.description,
      isTemplate: validation.ok,
      templateErrors: validation.ok || !claimsTemplate ? [] : validation.errors,
      counts: countTree(tree),
      ...(validation.primaryAirApp ? { primaryAirApp: validation.primaryAirApp } : {}),
      ...(tree.manifest.template?.category ? { category: tree.manifest.template.category } : {}),
      screenshots: tree.manifest.template?.screenshots ?? [],
      // Both sets: the manifest's own tags describe the package, the template's
      // describe the app. A catalog filters on one list, not two.
      tags: [...new Set([...tree.manifest.tags, ...(tree.manifest.template?.tags ?? [])])],
      agentPrompts: tree.manifest.template?.agentPrompts ?? [],
      ...(tree.manifest.version ? { version: tree.manifest.version } : {}),
      ...(tree.manifest.author ? { author: tree.manifest.author } : {}),
      ...(tree.manifest.license ? { license: tree.manifest.license } : {}),
    });
  }
  return found;
};

/**
 * Resolve a pasted URL to the ONE package to install, or explain the choice.
 *
 * `wanted` is a name or subdir the caller already picked (the CLI's `--skill`,
 * the dialog's selection). Matching on either is deliberate: a user reading a
 * list sees names, a user reading a repo sees directories, and asking them to
 * know which one the tool wants is a distinction without a purpose.
 */
export const resolvePackageToInstall = (
  files: PackageFiles,
  wanted?: string,
):
  | { kind: "package"; subdir: string; discovered: DiscoveredPackage }
  | { kind: "choose"; candidates: DiscoveredPackage[] }
  | { kind: "none" } => {
  const discovered = discoverPackages(files);
  if (discovered.length === 0) return { kind: "none" };

  if (wanted) {
    const match = discovered.find(
      (entry) =>
        entry.name === wanted || entry.subdir === wanted || entry.subdir.endsWith(`/${wanted}`),
    );
    if (match) return { kind: "package", subdir: match.subdir, discovered: match };
    return { kind: "choose", candidates: discovered };
  }

  // The repo's own root wins whenever it is a package: that is what the user
  // pasted, and a root package that also happens to vendor others is still the
  // thing they asked for.
  const root = discovered.find((entry) => entry.subdir === "");
  if (root) return { kind: "package", subdir: "", discovered: root };
  if (discovered.length === 1) {
    return { kind: "package", subdir: discovered[0].subdir, discovered: discovered[0] };
  }
  return { kind: "choose", candidates: discovered };
};
