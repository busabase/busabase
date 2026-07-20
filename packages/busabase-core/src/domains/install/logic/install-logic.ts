import "server-only";

import { createRouterClient, ORPCError } from "@orpc/server";
import type {
  InstallFromGithubDTO,
  InstallPlanFromGithubDTO,
  InstallPlanNodeVO,
  InstallPlanVO,
  InstallResultVO,
} from "busabase-contract/domains/install/types";
import { applyInstall } from "busabase-package/apply";
import type { PackageClient } from "busabase-package/client";
import type { ParsedGithubUrl } from "busabase-package/github";
import { readPackageTree } from "busabase-package/layout-read";
import {
  assertPlanIsApplicable,
  buildInstallPlan,
  type InstallPlan,
  resolveTargetState,
} from "busabase-package/plan";
import { type PackageNode, type PackageTree, suggestSlug } from "busabase-package/tree";
import { requireSpaceManagerForInstall } from "./_guard";
import { fetchPackageFiles } from "./github-source";

/**
 * Server-side "Install from GitHub" (spec §15). Fetch the zipball, read the
 * package, plan against the current space, and — for a real install — run the
 * five-pass apply.
 *
 * Not a second implementation of any of that: it is the *same* `busabase-package`
 * module the CLI runs, driven by an in-process oRPC router client instead of an
 * HTTP one. The five-pass apply (§7) is subtle and was expensive to get right; a
 * server-side copy would drift from the CLI's within one release.
 *
 * The size/count caps come along with that reuse rather than being re-listed
 * here: `extractZip` enforces the per-file, total-byte and file-count caps
 * against the archive's declared sizes *before* reading any bytes, `readPackageTree`
 * enforces the per-base record cap, and `buildInstallPlan` re-checks the file
 * count on the parsed tree. Nothing is created before all of them have passed.
 */

/**
 * The in-process client that drives the apply — no HTTP hop, no server talking to
 * itself over the network. Its calls inherit the ambient Busabase context
 * (space id, actor, `isSpaceManager`) through AsyncLocalStorage, so every write
 * lands in the caller's space under the caller's identity.
 *
 * The import is dynamic on purpose: `router.ts` composes this domain's router, so
 * a static import here would close a module cycle (router → install/router →
 * install/logic → router). Deferring it to call time breaks the cycle at
 * evaluation without giving up the type.
 */
const createInProcessClient = async (): Promise<PackageClient> => {
  const { busabaseRouter } = await import("../../../router");
  return createRouterClient(busabaseRouter);
};

interface PreparedInstall {
  plan: InstallPlan;
  source: ParsedGithubUrl;
  client: PackageClient;
}

/**
 * Fetch → read → plan, shared by the dry run and the real install. Takes only the
 * fields that shape the plan; `autoMerge` is not one of them (it decides what the
 * caller does with the plan, not what the plan contains), so both DTOs fit.
 */
const prepareInstall = async (
  input: Pick<InstallPlanFromGithubDTO, "repoUrl" | "intoFolder" | "rename">,
): Promise<PreparedInstall> => {
  requireSpaceManagerForInstall();

  const { source, files } = await fetchPackageFiles(input.repoUrl);

  let tree: PackageTree;
  try {
    // The extractor already stripped the archive root and the addressed subdir,
    // so the manifest sits at the root of what we hold.
    tree = readPackageTree(files);
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : "Could not read the package.",
    });
  }

  const client = await createInProcessClient();
  // Must derive the default the SAME way `buildInstallPlan` does, or the folder we
  // look up here isn't the folder the plan targets — collisions would be computed
  // against the wrong node. (A manifest name is free-form; a slug is not.)
  const targetFolderSlug = input.intoFolder ?? suggestSlug(tree.manifest.name);
  const target = await resolveTargetState(client, targetFolderSlug);

  let plan: InstallPlan;
  try {
    plan = buildInstallPlan(tree, target, {
      intoFolder: input.intoFolder,
      rename: input.rename,
    });
  } catch (error) {
    // The only throw here is a limit breach on the parsed tree.
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : "Could not plan the install.",
    });
  }

  return { plan, source, client };
};

export const planInstallFromGithub = async (
  input: InstallPlanFromGithubDTO,
): Promise<InstallPlanVO> => {
  const { plan, source } = await prepareInstall(input);
  // Plan for the options the caller actually intends. Hardcoding `false` here
  // would report `applicable: false` for every package whose records carry
  // relation values — the exact packages that auto-merge exists to install —
  // and a client gating its submit button on that would make them permanently
  // uninstallable.
  return toPlanVO(plan, source, input.autoMerge ?? false);
};

export const installFromGithub = async (input: InstallFromGithubDTO): Promise<InstallResultVO> => {
  const { plan, source, client } = await prepareInstall(input);
  const autoMerge = Boolean(input.autoMerge);

  try {
    assertPlanIsApplicable(plan, autoMerge);
  } catch (error) {
    // Unresolved collisions and the autoMerge requirement are both "fix your
    // request", and both messages already say exactly what to do.
    throw new ORPCError("CONFLICT", {
      message: error instanceof Error ? error.message : "This package cannot be installed as-is.",
    });
  }

  const result = await applyInstall(client, plan, {
    autoMerge,
    submittedBy: `install ${source.owner}/${source.repo} (${plan.tree.manifest.name})`,
  });

  return {
    targetFolderSlug: plan.targetFolderSlug,
    targetFolderNodeId: result.targetFolderNodeId,
    created: result.created,
    pendingChangeRequests: result.pendingChangeRequests,
    warnings: result.warnings,
  };
};

// ── PO/plan → VO ─────────────────────────────────────────────────────────────

/**
 * The in-memory plan carries a `Buffer` for every file in the package. The VO
 * carries an outline and counts instead: what a reviewer needs to decide "yes" is
 * the shape and the size of what would be created, and the bytes must not cross
 * the API boundary.
 */
const toPlanVO = (
  plan: InstallPlan,
  source: ParsedGithubUrl,
  autoMerge: boolean,
): InstallPlanVO => {
  // `assertPlanIsApplicable` throws a CLI-worded message ("Re-run with
  // --auto-merge…") that would be nonsense in a dialog with checkboxes, so only
  // its verdict crosses the API boundary. Clients word the reason themselves
  // from `collisions[]` and `requiresAutoMerge`.
  let applicable = true;
  try {
    assertPlanIsApplicable(plan, autoMerge);
  } catch {
    applicable = false;
  }

  const manifest = plan.tree.manifest;
  return {
    package: {
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      author: manifest.author,
      license: manifest.license,
      homepage: manifest.homepage,
      tags: manifest.tags,
    },
    source: {
      owner: source.owner,
      repo: source.repo,
      ref: source.ref,
      subdir: source.subdir,
    },
    targetFolderSlug: plan.targetFolderSlug,
    nodes: flattenNodes(plan.tree.nodes, "", 0),
    counts: plan.counts,
    collisions: plan.collisions.map((collision) => ({
      kind: collision.kind,
      slug: collision.slug,
      path: collision.path,
      renamedTo: collision.renamedTo,
    })),
    warnings: plan.warnings,
    requiresAutoMerge: plan.requiresAutoMerge,
    applicable,
  };
};

const flattenNodes = (
  nodes: readonly PackageNode[],
  prefix: string,
  depth: number,
): InstallPlanNodeVO[] => {
  const rows: InstallPlanNodeVO[] = [];
  for (const node of nodes) {
    const path = prefix ? `${prefix}/${node.slug}` : node.slug;
    rows.push({
      path,
      slug: node.slug,
      name: node.name,
      type: node.type,
      depth,
      fieldCount: node.type === "base" ? node.base.fields.length : undefined,
      recordCount: node.type === "base" ? node.records.length : undefined,
      fileCount:
        node.type === "skill" || node.type === "airapp" || node.type === "drive"
          ? node.files.length
          : undefined,
    });
    if (node.type === "folder") rows.push(...flattenNodes(node.children, path, depth + 1));
  }
  return rows;
};
