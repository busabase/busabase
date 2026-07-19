/**
 * Install planning: package tree + the target space's current state → a plan, a
 * collision report, and the `--dry-run` rendering. Creates nothing.
 *
 * Two distinct uniqueness rules apply, and conflating them is a bug:
 *   • node slugs are unique per PARENT   (`busabase_nodes_parent_slug_uniq` on
 *     (parentId, slug)) — so a folder/doc/skill only collides inside the target folder
 *   • base slugs are unique per SPACE    (`busabase_bases_space_slug_uniq` on
 *     (spaceId, slug)) — so a base collides against EVERY active base in the space,
 *     no matter which folder it sits in
 *
 * That space-wide rule is also why `options.targetBaseSlug` resolves unambiguously
 * server-side — and why renaming a base slug MUST rewrite every `targetBaseSlug`
 * that points at it (see `applyRenames`).
 */
import {
  PACKAGE_DEFERRED_FIELD_TYPES,
  PACKAGE_MAX_FILE_COUNT,
} from "busabase-contract/domains/package/types";
import {
  collectBaseNodes,
  type PackageBaseNode,
  type PackageNode,
  type PackageTree,
  walkNodes,
} from "./tree.js";

/** The subset of `nodes.list`'s output the planner needs. */
export interface ExistingNode {
  id: string;
  slug: string;
  type: string;
  children?: ExistingNode[];
}

export interface TargetState {
  /** The target folder, when it already exists. Its children are the collision scope. */
  targetFolder: ExistingNode | undefined;
  /** Every ACTIVE base slug in the space — base slugs are space-unique. */
  existingBaseSlugs: ReadonlySet<string>;
}

export type CollisionKind = "node" | "base";

export interface PlanCollision {
  kind: CollisionKind;
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
  /** The tree to apply — already rewritten when `--rename` resolved collisions. */
  tree: PackageTree;
  collisions: PlanCollision[];
  warnings: string[];
  counts: PlanCounts;
  /** True only when a record carries a relation value — see {@link hasUnlinkableRelationValues}. */
  requiresAutoMerge: boolean;
}

export interface BuildPlanOptions {
  /** Defaults to the manifest name (§12). */
  intoFolder?: string;
  rename?: boolean;
}

export const buildInstallPlan = (
  tree: PackageTree,
  target: TargetState,
  options: BuildPlanOptions = {},
): InstallPlan => {
  const targetFolderSlug = options.intoFolder ?? tree.manifest.name;
  const warnings: string[] = [];

  const existingChildSlugs = new Set(
    (target.targetFolder?.children ?? []).map((child) => child.slug),
  );
  const collisions = findCollisions(tree, targetFolderSlug, existingChildSlugs, target);

  let planned = tree;
  if (options.rename && collisions.length > 0) {
    planned = applyRenames(tree, collisions, existingChildSlugs, target.existingBaseSlugs);
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
    tree: planned,
    collisions,
    warnings,
    counts,
    requiresAutoMerge: collectBaseNodes(planned.nodes).some(hasUnlinkableRelationValues),
  };
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
  existingChildSlugs: ReadonlySet<string>,
  target: TargetState,
): PlanCollision[] => {
  const collisions: PlanCollision[] = [];
  // Only the package's TOP-LEVEL nodes land beside existing children of the target
  // folder; everything deeper lands under a directory this install creates.
  for (const node of tree.nodes) {
    if (existingChildSlugs.has(node.slug)) {
      collisions.push({ kind: "node", slug: node.slug, path: `${targetFolderSlug}/${node.slug}` });
    }
  }
  for (const baseNode of collectBaseNodes(tree.nodes)) {
    if (target.existingBaseSlugs.has(baseNode.slug)) {
      collisions.push({
        kind: "base",
        slug: baseNode.slug,
        path: `${targetFolderSlug}/… /${baseNode.slug} (base slugs are unique per space)`,
      });
    }
  }
  return collisions;
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
  existingChildSlugs: ReadonlySet<string>,
  existingBaseSlugs: ReadonlySet<string>,
): PackageTree => {
  const packageBaseSlugs = new Set(collectBaseNodes(tree.nodes).map((node) => node.slug));
  const takenNodeSlugs = new Set([...existingChildSlugs, ...tree.nodes.map((node) => node.slug)]);
  const takenBaseSlugs = new Set([...existingBaseSlugs, ...packageBaseSlugs]);

  const nodeRenames = new Map<string, string>();
  const baseRenames = new Map<string, string>();

  for (const collision of collisions) {
    if (collision.kind === "node") {
      const renamed = nextFreeSlug(collision.slug, takenNodeSlugs);
      takenNodeSlugs.add(renamed);
      nodeRenames.set(collision.slug, renamed);
      collision.renamedTo = renamed;
    } else {
      const renamed = nextFreeSlug(collision.slug, takenBaseSlugs);
      takenBaseSlugs.add(renamed);
      baseRenames.set(collision.slug, renamed);
      collision.renamedTo = renamed;
    }
  }

  const rewriteNode = (node: PackageNode, isTopLevel: boolean): PackageNode => {
    // A base node's slug is BOTH its node slug (unique per parent) and its base slug
    // (unique per space) — `bases.create` takes one `slug` for both, so they can only
    // ever be renamed together.
    if (node.type === "base") {
      const renamed =
        baseRenames.get(node.slug) ?? (isTopLevel ? nodeRenames.get(node.slug) : undefined);
      const slug = renamed ?? node.slug;
      return {
        ...node,
        slug,
        base: { ...node.base, fields: node.base.fields.map(rewriteFieldTarget) },
      };
    }
    const slug = (isTopLevel ? nodeRenames.get(node.slug) : undefined) ?? node.slug;
    if (node.type === "folder") {
      return { ...node, slug, children: node.children.map((child) => rewriteNode(child, false)) };
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

  return { ...tree, nodes: tree.nodes.map((node) => rewriteNode(node, true)) };
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
