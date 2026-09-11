import "server-only";

import { createRouterClient, ORPCError } from "@orpc/server";
import type {
  InstallEventVO,
  InstallFailureVO,
  InstallFromGithubDTO,
  InstallPlanFromGithubDTO,
  InstallPlanNodeVO,
  InstallPlanVO,
  InstallResultVO,
} from "busabase-contract/domains/install/types";
import { applyInstall, getInstallFailureDetails } from "busabase-package/apply";
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
import { getContextSpaceId } from "../../../context";
import { rootNodeIdForSpace } from "../../../logic/kernel";
import { hasNodePermission, shouldAutoMerge } from "../../../logic/node-acl";
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
    // Everything this throws is "fix the package or the request": a limit breach
    // on the parsed tree, a duplicate node identity, or a sample-record
    // dependency the installer refuses to guess at (a missing required relation,
    // a target key that is not in the declared target Base, a required-relation
    // cycle). All of them are checked before anything is created, and all of
    // them name the offending record — so the message is the useful part and has
    // to reach the caller rather than becoming a 500.
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : "Could not plan the install.",
    });
  }

  return { plan, source, client };
};

/**
 * Whether this caller's content would merge on the spot rather than queue.
 *
 * Permission-aware, exactly like every other write (`shouldAutoMerge`): omitted
 * `autoMerge` + `write` means "just do it", and only an explicit `false` forces
 * review. Content used to be pinned review-first here as a trust boundary
 * against the package author, but that check does not do what it looks like it
 * does: `requireSpaceManagerForInstall` already limits installing to a space
 * owner/admin, so the human approving those change requests was always the same
 * human who chose the repo a moment earlier. Deciding to install IS the trust
 * decision; making them re-approve their own import afterwards was ceremony.
 *
 * The workspace root is the right node to ask about: `intoFolder` may not exist
 * yet on a first install, and the root is what every install ultimately hangs
 * off. It is also what keeps the one cap that still bites — a credential with a
 * `changeRequest` permission ceiling resolves below `write` here and therefore
 * still lands its content for review, manager or not.
 */
const callerMergesDirectly = async (requestedAutoMerge: boolean | undefined): Promise<boolean> =>
  shouldAutoMerge(
    requestedAutoMerge,
    await hasNodePermission(rootNodeIdForSpace(getContextSpaceId()), "write"),
  );

export const planInstallFromGithub = async (
  input: InstallPlanFromGithubDTO,
): Promise<InstallPlanVO> => {
  const { plan, source } = await prepareInstall(input);
  // Plan for what this caller would ACTUALLY get, so `applicable` answers the
  // question they are about to ask. Hardcoding `false` here would report
  // `applicable: false` for every package whose records carry relation values —
  // the exact packages auto-merge exists to install — and a client gating its
  // submit button on that would make them permanently uninstallable.
  return toPlanVO(plan, source, await callerMergesDirectly(input.autoMerge));
};

export const installFromGithub = async (input: InstallFromGithubDTO): Promise<InstallResultVO> => {
  const { plan, source, client } = await prepareInstall(input);
  const autoMerge = await callerMergesDirectly(input.autoMerge);

  try {
    assertPlanIsApplicable(plan, autoMerge);
  } catch (error) {
    // Unresolved collisions and the autoMerge requirement are both "fix your
    // request", and both messages already say exactly what to do.
    throw new ORPCError("CONFLICT", {
      message: error instanceof Error ? error.message : "This package cannot be installed as-is.",
    });
  }

  const result = await runApply(client, plan, {
    autoMerge,
    submittedBy: `install ${source.owner}/${source.repo} (${plan.tree.manifest.name})`,
    // Recorded on an app's root Folder so the space remembers where it came
    // from. Without it an installed app carries no memory of its origin, and
    // "a newer version of this is available" becomes unanswerable.
    source: {
      repo: `${source.owner}/${source.repo}`,
      ref: source.ref,
      ...(source.subdir ? { subdir: source.subdir } : {}),
    },
    // `applyInstall` needs an origin to resolve a root-relative upload url
    // against (the shape a local-disk `STORAGE_URL` hands out — see its
    // `serverUrl` doc). `createInProcessClient()` above skips HTTP entirely for
    // every oRPC call, but an uploaded asset's bytes still go over a real
    // `fetch()` PUT, so this one path needs a real address to loop back to. The
    // process IS that server, listening on `PORT` when it is set — Docker, the
    // desktop sidecar, and `busabase-cli`'s launcher all set it explicitly.
    //
    // This router is shared by both hosts (`busabase-core`'s kernel), so it
    // cannot default to either app's dev port when `PORT` is unset — busabase's
    // is 15419, busabase-cloud's is Next's own default 3000, and guessing wrong
    // would silently misdirect the other host. `PORT` unset only happens in a
    // bare `pnpm dev` inner loop anyway, never in a real distribution, and cloud
    // production never reaches this branch at all (S3 hands back an absolute
    // presigned url, which `resolveUploadUrl` uses as-is).
    serverUrl: process.env.PORT ? `http://localhost:${process.env.PORT}` : undefined,
  });

  return {
    targetFolderSlug: plan.targetFolderSlug,
    targetFolderNodeId: result.targetFolderNodeId,
    created: result.created,
    pendingChangeRequests: result.pendingChangeRequests,
    warnings: result.warnings,
  };
};

/**
 * The same install as {@link installFromGithub}, yielding progress as it goes.
 *
 * Why this exists: the non-streaming route does minutes of work before writing
 * a single byte of response, and a proxy in front of the app closes a socket
 * that has been idle that long. The install keeps running server-side after the
 * disconnect, so the user is told it failed while it actually succeeded —
 * they then retry and hit slug collisions from their own first attempt.
 *
 * The fix is not a longer timeout (there is always a bigger template); it is to
 * stop being silent. `applyInstall` already reports each pass through
 * `onProgress` — the plain route just threw those messages away.
 *
 * The queue below bridges two shapes: `onProgress` is a synchronous callback
 * that cannot await a consumer, while a generator must not drop events between
 * yields. Same buffer-and-wake pattern as `runOrAttachSession` in the airapp
 * domain, for the same reason.
 */
export async function* installFromGithubStream(
  input: InstallFromGithubDTO,
): AsyncGenerator<InstallEventVO> {
  // Reported before the await, not after: fetching and unpacking the zipball is
  // typically the LONGEST single step of an install (measured at ~9s of a ~10s
  // install of a mid-size template) and it is the one step `applyInstall` cannot
  // report on, because it happens before apply is even called. Without this the
  // user watches a spinner through the slowest part and only sees progress once
  // the quick part starts.
  yield { kind: "progress", message: "Fetching the package from GitHub…" };
  const { plan, source, client } = await prepareInstall(input);
  // Same permission-aware resolution as the non-streaming path above — this is
  // the one the dashboard actually calls, so hardcoding `false` here would have
  // left the UI on review-first while everything else merged.
  const autoMerge = await callerMergesDirectly(input.autoMerge);

  try {
    assertPlanIsApplicable(plan, autoMerge);
  } catch (error) {
    throw new ORPCError("CONFLICT", {
      message: error instanceof Error ? error.message : "This package cannot be installed as-is.",
    });
  }

  yield {
    kind: "progress",
    message: `Installing ${plan.tree.manifest.name} into "${plan.targetFolderSlug}"…`,
  };

  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;

  const applying = runApply(client, plan, {
    autoMerge,
    submittedBy: `install ${source.owner}/${source.repo} (${plan.tree.manifest.name})`,
    source: {
      repo: `${source.owner}/${source.repo}`,
      ref: source.ref,
      ...(source.subdir ? { subdir: source.subdir } : {}),
    },
    serverUrl: process.env.PORT ? `http://localhost:${process.env.PORT}` : undefined,
    onProgress: (message) => {
      queue.push(message);
      wake?.();
      wake = null;
    },
  }).finally(() => {
    finished = true;
    wake?.();
    wake = null;
  });

  // Attach a handler now so a rejection between here and the `await` below is
  // never an unhandled one. The real error still reaches the consumer, thrown
  // by that `await` — this only stops Node from treating it as unobserved.
  applying.catch(() => {});

  while (true) {
    while (queue.length > 0) {
      const message = queue.shift();
      if (message !== undefined) yield { kind: "progress", message };
    }
    if (finished) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }

  // Drain what the apply reported between the last check and finishing —
  // otherwise the final pass's message is lost exactly when it matters most.
  while (queue.length > 0) {
    const message = queue.shift();
    if (message !== undefined) yield { kind: "progress", message };
  }

  // Rethrows a failed apply, already wrapped by `runApply` into an ORPCError
  // carrying the partial-install details.
  const result = await applying;
  yield {
    kind: "done",
    result: {
      targetFolderSlug: plan.targetFolderSlug,
      targetFolderNodeId: result.targetFolderNodeId,
      created: result.created,
      pendingChangeRequests: result.pendingChangeRequests,
      warnings: result.warnings,
    },
  };
}

/**
 * Run the five-pass apply and make sure its failure survives the RPC boundary.
 *
 * oRPC replaces any thrown error that is not an `ORPCError` with a generic
 * `INTERNAL_SERVER_ERROR` whose message is the literal string "Internal server
 * error" (`toORPCError`). `applyInstall` throws through whatever the underlying
 * call threw — and the interesting ones are plain `Error`s (a rejected change
 * request review carries its reason as a message, not as an `ORPCError`). Left
 * unwrapped, the dialog shows "Internal server error" for exactly the failure
 * the user most needs to read: structure was created, content was not, and the
 * space now holds half an install.
 *
 * Note that an in-process caller (`createRouterClient`, which is how the
 * integration tests drive this) never serializes and so never sees that
 * substitution — this wrapper is the only thing standing between the browser and
 * an opaque 500, and only a real round trip proves it.
 */
const runApply = async (
  client: PackageClient,
  plan: InstallPlan,
  options: Parameters<typeof applyInstall>[2],
): Promise<Awaited<ReturnType<typeof applyInstall>>> => {
  try {
    return await applyInstall(client, plan, options);
  } catch (error) {
    throw toInstallOrpcError(error);
  }
};

/**
 * An apply failure → the `ORPCError` the client sees, keeping three things the
 * default conversion throws away: the message, the original code/status, and the
 * partial-install facts.
 *
 * The code matters as much as the message. `approveAndMerge` reports a refused
 * review as a plain `Error` that carries the refusal's `code` as a property, so
 * "you may not merge this" and "the server broke" arrive in the same shape —
 * flattening both to a 500 is how a permission or quota problem starts looking
 * like a bug in the installer.
 *
 * Exported for its own tests: every branch here is a failure path that is
 * awkward to provoke end-to-end, and an untested error mapping is how the
 * message gets lost again.
 */
export const toInstallOrpcError = (error: unknown): ORPCError<string, unknown> => {
  const failure = getInstallFailureDetails(error);
  const diagnostics: InstallFailureVO | undefined = failure
    ? {
        phase: failure.phase,
        targetFolderSlug: failure.targetFolderSlug,
        created: failure.created,
        pendingChangeRequests: failure.pendingChangeRequests,
      }
    : undefined;

  if (error instanceof ORPCError) {
    return new ORPCError(error.code, {
      status: error.status,
      message: error.message,
      data: diagnostics ? { ...toDataObject(error.data), ...diagnostics } : error.data,
      cause: error,
    });
  }

  const carried = error as { code?: unknown; status?: unknown; data?: unknown } | null;
  const code = typeof carried?.code === "string" && carried.code ? carried.code : undefined;
  const status = typeof carried?.status === "number" ? carried.status : undefined;
  return new ORPCError(code ?? "INTERNAL_SERVER_ERROR", {
    ...(status ? { status } : {}),
    message: error instanceof Error ? error.message : "The install failed.",
    data: diagnostics ? { ...toDataObject(carried?.data), ...diagnostics } : carried?.data,
    cause: error,
  });
};

/** Only an object-shaped `data` can be merged into; anything else is dropped. */
const toDataObject = (data: unknown): Record<string, unknown> =>
  typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};

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

  // The root `SKILL.md` becomes a real Skill node on install (`apply.ts`), but
  // the package tree keeps it BESIDE `nodes` rather than inside it — so a
  // preview built from `nodes` alone silently omits the one node that decides
  // whether an agent can use what was just installed, and reports `skills: 0`
  // for a package that plainly carries a manual. Fold it in here, where the
  // outline is built for a human to read, rather than in `countTree` (whose
  // counts also police the file-count cap on the bytes actually walked).
  const rootSkill = plan.tree.rootSkill;
  const nodes = flattenNodes(plan.tree.nodes, "", 0);
  const counts = { ...plan.counts };
  if (rootSkill) {
    nodes.unshift({
      path: rootSkill.slug,
      slug: rootSkill.slug,
      name: rootSkill.name,
      type: "skill",
      depth: 0,
      fileCount: rootSkill.files.length,
    });
    counts.skills += 1;
    counts.files += rootSkill.files.length;
  }

  return {
    package: {
      name: manifest.name,
      ...(manifest.displayName ? { displayName: manifest.displayName } : {}),
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
    nodes,
    counts,
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
