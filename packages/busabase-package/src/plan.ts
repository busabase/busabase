/**
 * Install planning: package tree + the target space's current state → a plan, a
 * collision report, and the `--dry-run` rendering. Creates nothing.
 *
 * Active node slugs are unique by `(spaceId, nodeType, slug)`. Every package
 * node therefore collides against same-type nodes anywhere in the target space,
 * while different types may intentionally reuse the same slug. Renaming a base
 * must also rewrite every relation `targetBaseSlug` that points at it.
 */
import { PACKAGE_MAX_FILE_COUNT } from "busabase-contract/domains/package/types";
import type { PackageClient } from "./client";
import { validateTemplate } from "./template";
import {
  collectBaseNodes,
  type PackageBaseNode,
  type PackageNode,
  type PackageTree,
  suggestSlug,
  walkNodes,
} from "./tree";

/** The subset of `nodes.list`'s output the planner needs. */
export interface ExistingNode {
  id: string;
  slug: string;
  type: string;
  children?: ExistingNode[];
}

export interface TargetState {
  /** The target folder, when it already exists anywhere in the space. */
  targetFolder: ExistingNode | undefined;
  /** Every active node slug in the space, grouped by node type. */
  existingNodeSlugsByType: ReadonlyMap<string, ReadonlySet<string>>;
}

const flattenExistingNodes = (nodes: readonly ExistingNode[]): ExistingNode[] => {
  const result: ExistingNode[] = [];
  const visit = (node: ExistingNode): void => {
    result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return result;
};

/**
 * The target folder is addressed by slug. Folder slugs are space-unique, so its
 * tree depth is irrelevant and the match is unambiguous.
 */
export const findTargetFolder = (
  nodes: readonly ExistingNode[],
  slug: string,
): ExistingNode | undefined => {
  return flattenExistingNodes(nodes).find((node) => node.slug === slug && node.type === "folder");
};

/**
 * Read the target space's current node identity state before planning. Kept
 * next to {@link buildInstallPlan} so the CLI and the
 * server-side install domain resolve collisions from identical inputs.
 */
export const resolveTargetState = async (
  client: PackageClient,
  targetFolderSlug: string,
): Promise<TargetState> => {
  const listedNodes = (await client.nodes.list({})) as unknown as ExistingNode[];
  const slugsByType = new Map<string, Set<string>>();
  for (const node of flattenExistingNodes(listedNodes)) {
    const slugs = slugsByType.get(node.type) ?? new Set<string>();
    slugs.add(node.slug);
    slugsByType.set(node.type, slugs);
  }
  return {
    targetFolder: findTargetFolder(listedNodes, targetFolderSlug),
    existingNodeSlugsByType: slugsByType,
  };
};

export type CollisionKind = "node" | "base";

export interface PlanCollision {
  kind: CollisionKind;
  nodeType: string;
  slug: string;
  /** Human-readable location, e.g. `my-package/product-catalog`. */
  path: string;
  /** Set when `--rename` resolved it. */
  renamedTo?: string;
}

export interface PlanCounts {
  folders: number;
  docs: number;
  bases: number;
  records: number;
  skills: number;
  airapps: number;
  drives: number;
  files: number;
}

export interface InstallPlan {
  targetFolderSlug: string;
  /** Existing target folder to reuse, including the workspace root itself. */
  existingTargetFolderNodeId?: string;
  /** The tree to apply — already rewritten when `--rename` resolved collisions. */
  tree: PackageTree;
  collisions: PlanCollision[];
  warnings: string[];
  counts: PlanCounts;
  /** True only when a record carries a relation value — see {@link hasUnlinkableRelationValues}. */
  requiresAutoMerge: boolean;
  /**
   * Installed node slug → the slug the package declared, for every node whose
   * slug this plan rewrote (folder-prefixing, `--rename`, or both).
   *
   * The ownership stamp has to carry the ORIGINAL: an app looks its own Base up
   * by a stable internal handle (`contacts`), and if the stamp recorded the
   * installed slug instead, the same app installed into two folders would
   * appear to be two different apps to its own code.
   */
  resourceKeysBySlug: Record<string, string>;
  /**
   * Whether this package installs AS an app (Skill node, ownership stamps,
   * sample-record merge).
   *
   * Decided HERE, against the package as the author wrote it, and carried
   * forward — not re-derived later. The plan rewrites slugs (folder-prefixing,
   * `--rename`), and the validator cross-checks the manual's declared resources
   * against those slugs; asking it again after the rewrite makes a perfectly
   * valid template fail its own resource check and silently install as a plain
   * package, stamping nothing. One evaluation, one answer.
   */
  isTemplate: boolean;
}

export interface BuildPlanOptions {
  /** Defaults to the manifest name (§12). */
  intoFolder?: string;
  rename?: boolean;
  /**
   * Prefix each Base's slug with the target folder's, so `reviews` installs as
   * `kelly-email-reviews`.
   *
   * Base slugs are unique per SPACE, not per folder, and templates converge on
   * the same generic names — `settings`, `contacts`, `tasks`. Without a prefix
   * the second template a user installs collides on names the author never
   * chose to share, and the best outcome available is a `-2` suffix nobody can
   * predict. Prefixing makes the collision not happen in the first place.
   *
   * Defaults to on for templates (which is where the convergence problem is)
   * and off otherwise, so existing packages keep the slugs their authors wrote.
   * Nothing depends on the resulting slug: the ownership stamp records each
   * node's ORIGINAL package slug as its `resourceKey`, which is the handle an
   * app's own code looks it up by.
   */
  prefixBaseSlugs?: boolean;
  /**
   * Whether a template's sample records will be merged on install (apply's
   * default is yes).
   *
   * Only affects `requiresAutoMerge`, and only for templates — but it matters:
   * that flag makes the dashboard demand "install without review", which merges
   * the AirApp CODE too. A template whose records merge anyway has no reason to
   * demand it, and demanding it would push the user into auto-merging exactly
   * the part that must stay review-first.
   */
  installSampleRecords?: boolean;
}

export const buildInstallPlan = (
  tree: PackageTree,
  target: TargetState,
  options: BuildPlanOptions = {},
): InstallPlan => {
  // The manifest NAME is free-form ("Support KB Starter"); a node slug must match
  // /^[a-z0-9-]+$/. Using the name raw made the default target folder unusable —
  // the install failed with a bare "Input validation failed", and the dialog made
  // it worse by prefilling that same rejected value. An explicit `intoFolder` is
  // taken as given (it is validated downstream, so a bad one still errors clearly).
  const targetFolderSlug = options.intoFolder ?? suggestSlug(tree.manifest.name);
  const warnings: string[] = [];

  assertPackageNodeIdentitiesUnique(tree);

  // Prefixing happens BEFORE collision detection, because the prefixed slug is
  // the one that will actually be created — detecting collisions on the
  // package's own slugs would report clashes that prefixing already avoided and
  // miss any the prefix introduces.
  const isTemplate = validateTemplate(tree).ok;
  const shouldPrefix = options.prefixBaseSlugs ?? isTemplate;
  const prefixed = shouldPrefix ? prefixBaseSlugs(tree, targetFolderSlug) : tree;
  const resourceKeysBySlug: Record<string, string> = {};
  for (const [installedSlug, originalSlug] of collectSlugRewrites(tree, prefixed)) {
    resourceKeysBySlug[installedSlug] = originalSlug;
  }

  const collisions = findCollisions(prefixed, targetFolderSlug, target);

  let planned = prefixed;
  if (options.rename && collisions.length > 0) {
    planned = applyRenames(prefixed, collisions, target.existingNodeSlugsByType);
    // A rename layers on top of a prefix, so re-derive against the ORIGINAL
    // tree — otherwise a doubly-rewritten node would record its prefixed slug
    // as the app's handle instead of the one the package declared.
    for (const [installedSlug, originalSlug] of collectSlugRewrites(tree, planned)) {
      resourceKeysBySlug[installedSlug] = originalSlug;
    }
  }

  collectWarnings(planned, warnings);
  const counts = countTree(planned);
  if (counts.files > PACKAGE_MAX_FILE_COUNT) {
    throw new Error(
      `Package has ${counts.files} files, above the ${PACKAGE_MAX_FILE_COUNT}-file limit. Nothing was installed.`,
    );
  }

  return {
    targetFolderSlug,
    existingTargetFolderNodeId: target.targetFolder?.id,
    tree: planned,
    collisions,
    warnings,
    counts,
    requiresAutoMerge:
      collectBaseNodes(planned.nodes).some(hasUnlinkableRelationValues) &&
      // A template merges its own sample records (apply's `installSampleRecords`),
      // so pass 5 does have record ids to link and the user need not be pushed
      // into a full auto-merge install.
      !(isTemplate && (options.installSampleRecords ?? true)),
    resourceKeysBySlug,
    isTemplate,
  };
};

/**
 * Rewrite every Base slug to `<folder>-<slug>`, following relation targets.
 *
 * A Base already carrying the prefix is left alone, so re-planning an installed
 * package (an upgrade, a retry) does not stack `kelly-email-kelly-email-…`.
 * Only Bases are prefixed: every other node type is scoped to its parent
 * folder, so only Bases can collide across folders in the first place.
 */
const prefixBaseSlugs = (tree: PackageTree, folderSlug: string): PackageTree => {
  const renames = new Map<string, string>();
  for (const node of walkNodes(tree.nodes)) {
    if (node.type !== "base") continue;
    if (node.slug === folderSlug || node.slug.startsWith(`${folderSlug}-`)) continue;
    renames.set(node.slug, `${folderSlug}-${node.slug}`);
  }
  if (renames.size === 0) return tree;

  const rewriteField = <T extends { options: { targetBaseSlug?: string } }>(field: T): T => {
    const target = field.options.targetBaseSlug;
    if (!target) return field;
    const renamed = renames.get(target);
    return renamed ? { ...field, options: { ...field.options, targetBaseSlug: renamed } } : field;
  };

  const rewrite = (node: PackageNode): PackageNode => {
    if (node.type === "folder") return { ...node, children: node.children.map(rewrite) };
    if (node.type !== "base") return node;
    return {
      ...node,
      slug: renames.get(node.slug) ?? node.slug,
      base: { ...node.base, fields: node.base.fields.map(rewriteField) },
    };
  };

  return { ...tree, nodes: tree.nodes.map(rewrite) };
};

/**
 * Pair up two trees that differ only in slugs, walking them in lockstep.
 *
 * Position-based rather than slug-based on purpose: after a rewrite the slugs
 * are exactly what no longer match, so they cannot be the join key. Both trees
 * come from the same source and every rewrite preserves order, so position is
 * stable.
 */
const collectSlugRewrites = (
  original: PackageTree,
  rewritten: PackageTree,
): Array<[installedSlug: string, originalSlug: string]> => {
  const pairs: Array<[string, string]> = [];
  const walk = (before: readonly PackageNode[], after: readonly PackageNode[]): void => {
    for (const [index, beforeNode] of before.entries()) {
      const afterNode = after[index];
      if (!afterNode) continue;
      pairs.push([afterNode.slug, beforeNode.slug]);
      if (beforeNode.type === "folder" && afterNode.type === "folder") {
        walk(beforeNode.children, afterNode.children);
      }
    }
  };
  walk(original.nodes, rewritten.nodes);
  return pairs;
};

/**
 * The ONLY thing that genuinely can't survive a review-first install: a record that
 * carries a relation VALUE. A relation value is the id of another record, and those
 * ids exist only once the record change requests are merged (pass 5) — so
 * review-first would install the relation empty.
 *
 * Deliberately narrower than `PACKAGE_DEFERRED_FIELD_TYPES`. Being deferred to pass 2
 * is about *ordering* (a relation's `targetBaseSlug` needs its target base to exist;
 * an AI field's `ai.sourceFieldIds` need sibling field ids), and passes 2-3 now always
 * run against an immediately-created Base — so an AI field needs no merged records and
 * must not force `--auto-merge` on the user. Nor must a relation *schema* with no
 * relation values to link.
 */
export const hasUnlinkableRelationValues = (node: PackageBaseNode): boolean => {
  const relationSlugs = node.base.fields
    .filter((field) => field.type === "relation")
    .map((field) => field.slug);
  if (relationSlugs.length === 0) return false;
  return node.records.some((record) =>
    relationSlugs.some((slug) => {
      const value = record.fields[slug];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    }),
  );
};

const findCollisions = (
  tree: PackageTree,
  targetFolderSlug: string,
  target: TargetState,
): PlanCollision[] => {
  const collisions: PlanCollision[] = [];
  for (const node of walkNodes(tree.nodes)) {
    if (target.existingNodeSlugsByType.get(node.type)?.has(node.slug)) {
      collisions.push({
        kind: node.type === "base" ? "base" : "node",
        nodeType: node.type,
        slug: node.slug,
        path: `${targetFolderSlug}/…/${node.slug} (${node.type} slugs are unique per space)`,
      });
    }
  }
  return collisions;
};

const nodeIdentityKey = (node: Pick<PackageNode, "type" | "slug">): string =>
  `${node.type}\0${node.slug}`;

const assertPackageNodeIdentitiesUnique = (tree: PackageTree): void => {
  const seen = new Set<string>();
  for (const node of walkNodes(tree.nodes)) {
    const key = nodeIdentityKey(node);
    if (seen.has(key)) {
      throw new Error(
        `Package contains duplicate ${node.type} slug "${node.slug}". Node slugs must be unique by type within a space.`,
      );
    }
    seen.add(key);
  }
};

/** `products` → `products-2`, `products-3`, … skipping anything already taken. */
const nextFreeSlug = (slug: string, taken: ReadonlySet<string>): string => {
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${slug}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not find a free slug for "${slug}" after 999 attempts.`);
};

/**
 * Resolve collisions by renaming, and — critically — rewrite every relation's
 * `options.targetBaseSlug` that pointed at a renamed base.
 *
 * Skipping that rewrite is a SILENT data-corruption path, not a cosmetic bug: the
 * server resolves `targetBaseSlug` against active bases in the space, so a relation
 * still naming the original slug would bind to the PRE-EXISTING foreign base that
 * caused the collision in the first place — succeeding, with the wrong target.
 */
const applyRenames = (
  tree: PackageTree,
  collisions: PlanCollision[],
  existingNodeSlugsByType: ReadonlyMap<string, ReadonlySet<string>>,
): PackageTree => {
  const takenByType = new Map<string, Set<string>>();
  for (const [type, slugs] of existingNodeSlugsByType) {
    takenByType.set(type, new Set(slugs));
  }
  for (const node of walkNodes(tree.nodes)) {
    const taken = takenByType.get(node.type) ?? new Set<string>();
    taken.add(node.slug);
    takenByType.set(node.type, taken);
  }

  const nodeRenames = new Map<string, string>();
  const baseRenames = new Map<string, string>();

  for (const collision of collisions) {
    const node = [...walkNodes(tree.nodes)].find(
      (candidate) => candidate.type === collision.nodeType && candidate.slug === collision.slug,
    );
    if (!node) continue;
    const taken = takenByType.get(node.type) ?? new Set<string>();
    const renamed = nextFreeSlug(collision.slug, taken);
    taken.add(renamed);
    takenByType.set(node.type, taken);
    nodeRenames.set(nodeIdentityKey(node), renamed);
    if (node.type === "base") baseRenames.set(node.slug, renamed);
    collision.renamedTo = renamed;
  }

  const rewriteNode = (node: PackageNode): PackageNode => {
    const slug = nodeRenames.get(nodeIdentityKey(node)) ?? node.slug;
    if (node.type === "base") {
      return {
        ...node,
        slug,
        base: { ...node.base, fields: node.base.fields.map(rewriteFieldTarget) },
      };
    }
    if (node.type === "folder") {
      return { ...node, slug, children: node.children.map(rewriteNode) };
    }
    return { ...node, slug };
  };

  const rewriteFieldTarget = <T extends { options: { targetBaseSlug?: string } }>(field: T): T => {
    const targetBaseSlug = field.options.targetBaseSlug;
    if (!targetBaseSlug) return field;
    const renamed = baseRenames.get(targetBaseSlug);
    if (!renamed) return field;
    return { ...field, options: { ...field.options, targetBaseSlug: renamed } };
  };

  return { ...tree, nodes: tree.nodes.map(rewriteNode) };
};

const collectWarnings = (tree: PackageTree, warnings: string[]): void => {
  for (const baseNode of collectBaseNodes(tree.nodes)) {
    if (baseNode.base.reviewPolicy) {
      warnings.push(
        `Base "${baseNode.slug}" declares a reviewPolicy (${baseNode.base.reviewPolicy.kind}, ${baseNode.base.reviewPolicy.requiredApprovals} approval(s)), but reviewPolicy cannot be set when creating a Base — the target's default applies. Adjust it in the UI afterwards if needed.`,
      );
    }
  }
};

export const countTree = (tree: PackageTree): PlanCounts => {
  const counts: PlanCounts = {
    folders: 0,
    docs: 0,
    bases: 0,
    records: 0,
    skills: 0,
    airapps: 0,
    drives: 0,
    files: 0,
  };
  for (const node of walkNodes(tree.nodes)) {
    switch (node.type) {
      case "folder":
        counts.folders++;
        break;
      case "doc":
        counts.docs++;
        break;
      case "base":
        counts.bases++;
        counts.records += node.records.length;
        break;
      case "skill":
        counts.skills++;
        counts.files += node.files.length;
        break;
      case "airapp":
        counts.airapps++;
        counts.files += node.files.length;
        break;
      case "drive":
        counts.drives++;
        counts.files += node.files.length;
        break;
      case "file":
        counts.files++;
        break;
    }
  }
  // Doc images are real files in the package and real uploads on install, so the
  // file-count cap has to see them — a package could otherwise carry 5000 images
  // under a cap that only counted nodes.
  counts.files += (tree.assets ?? []).length;
  return counts;
};

/** §4: "What will this do?" — the `--dry-run` report. Creates nothing. */
export const renderPlan = (plan: InstallPlan): string => {
  const lines: string[] = [];
  lines.push(`Package: ${plan.tree.manifest.name}`);
  if (plan.tree.manifest.description) lines.push(`  ${plan.tree.manifest.description}`);
  lines.push("");
  lines.push(`Target folder: ${plan.targetFolderSlug}`);
  lines.push("");
  lines.push("Node tree:");
  for (const line of renderNodeTree(plan.tree.nodes, "  ")) lines.push(line);
  lines.push("");
  lines.push(
    `Totals: ${plan.counts.folders} folder(s), ${plan.counts.docs} doc(s), ${plan.counts.bases} base(s) with ${plan.counts.records} record(s), ${plan.counts.skills} skill(s), ${plan.counts.airapps} airapp(s), ${plan.counts.drives} drive(s), ${plan.counts.files} file(s)`,
  );

  if (plan.collisions.length > 0) {
    lines.push("");
    lines.push("Collisions:");
    for (const collision of plan.collisions) {
      lines.push(
        collision.renamedTo
          ? `  • ${collision.kind} "${collision.slug}" already exists → will be created as "${collision.renamedTo}"`
          : `  • ${collision.kind} "${collision.slug}" already exists (${collision.path})`,
      );
    }
  }
  if (plan.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of plan.warnings) lines.push(`  • ${warning}`);
  }
  return lines.join("\n");
};

const renderNodeTree = (nodes: readonly PackageNode[], indent: string): string[] => {
  const lines: string[] = [];
  for (const node of nodes) {
    const detail =
      node.type === "base"
        ? ` (base, ${node.base.fields.length} field(s), ${node.records.length} record(s))`
        : node.type === "folder"
          ? " (folder)"
          : node.type === "doc"
            ? " (doc)"
            : node.type === "file"
              ? " (file)"
              : ` (${node.type}, ${node.files.length} file(s))`;
    lines.push(`${indent}${node.slug}${detail}`);
    if (node.type === "folder") lines.push(...renderNodeTree(node.children, `${indent}  `));
  }
  return lines;
};

/**
 * §4 + §12: without `--auto-merge` an unmerged base has no field ids to patch and no
 * records to link, so passes 2-5 cannot run. Fail fast and say exactly why.
 */
export const assertPlanIsApplicable = (plan: InstallPlan, autoMerge: boolean): void => {
  if (plan.collisions.some((collision) => !collision.renamedTo)) {
    const list = plan.collisions
      .filter((collision) => !collision.renamedTo)
      .map((collision) => `  • ${collision.kind} "${collision.slug}" (${collision.path})`)
      .join("\n");
    throw new Error(
      `Install would collide with content that already exists:\n${list}\n\nNothing was created. Re-run with --rename to install the colliding items under suffixed slugs (e.g. "-2"), or pick a different --into-folder.`,
    );
  }
  if (plan.requiresAutoMerge && !autoMerge) {
    throw new Error(
      "This package's records carry relation values, and a relation stores the ids of the records it points at — which only exist once the records are merged. Installing review-first would leave every relation empty.\n\nRe-run with --auto-merge to install it (this trusts the package author: records are created immediately instead of landing as change requests you review first).",
    );
  }
};
