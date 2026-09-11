/**
 * Install domain — DTO inputs and VO outputs for server-side "Install from
 * GitHub" (spec §15). Pure zod: no logic/db/node imports, so this module is
 * client-safe and the web UI validates exactly what the server does.
 *
 * The VOs are deliberately *flat and rendering-shaped*, not a re-export of
 * `busabase-package`'s in-memory `PackageTree`: that tree carries `Buffer`
 * payloads for every file in the package, which must never cross the API
 * boundary. What a reviewer needs before saying yes is the shape and the size of
 * what would be created — so the tree becomes a flat, depth-tagged outline and
 * the bytes stay on the server.
 */
import { iStringSchema } from "openlib/i18n/i-string";
import { z } from "zod";

/** Every node type the package format can install, as it appears in a plan outline. */
export const InstallPlanNodeTypeSchema = z.enum([
  "folder",
  "doc",
  "base",
  "skill",
  "airapp",
  "drive",
  "file",
]);
export type InstallPlanNodeType = z.infer<typeof InstallPlanNodeTypeSchema>;

/**
 * One line of the plan's node outline. Flat rather than recursive: `depth` carries
 * the nesting, which renders as a tree without a recursive zod schema (and without
 * the `z.lazy` that a recursive VO would force on every client).
 */
export const InstallPlanNodeVOSchema = z.object({
  /** Package-relative path, e.g. `guides/faq`. Unique within a plan. */
  path: z.string(),
  slug: z.string(),
  name: z.string(),
  type: InstallPlanNodeTypeSchema,
  /** 0 for a top-level node under the target folder. */
  depth: z.number().int().min(0),
  /** Bases only. */
  fieldCount: z.number().int().min(0).optional(),
  /** Bases only — the per-base record count §15.4 asks the plan to surface. */
  recordCount: z.number().int().min(0).optional(),
  /** skill / airapp / drive only — files carried verbatim inside the node. */
  fileCount: z.number().int().min(0).optional(),
});
export type InstallPlanNodeVO = z.infer<typeof InstallPlanNodeVOSchema>;

/**
 * A slug already taken in the target. `kind` matters: node slugs are unique per
 * PARENT, base slugs per SPACE — so a base can collide from a completely
 * different folder.
 */
export const InstallCollisionVOSchema = z.object({
  kind: z.enum(["node", "base"]),
  slug: z.string(),
  /** Human-readable location, e.g. `my-package/product-catalog`. */
  path: z.string(),
  /** Set when `rename` resolved it — the slug that would actually be created. */
  renamedTo: z.string().optional(),
});
export type InstallCollisionVO = z.infer<typeof InstallCollisionVOSchema>;

export const InstallPlanCountsVOSchema = z.object({
  folders: z.number().int().min(0),
  docs: z.number().int().min(0),
  bases: z.number().int().min(0),
  records: z.number().int().min(0),
  skills: z.number().int().min(0),
  airapps: z.number().int().min(0),
  drives: z.number().int().min(0),
  files: z.number().int().min(0),
});
export type InstallPlanCountsVO = z.infer<typeof InstallPlanCountsVOSchema>;

/** The package's own metadata, as declared in its `busabase.json`. */
export const InstallPackageInfoVOSchema = z.object({
  name: z.string(),
  /** Optional human-facing title — falls back to `name` when the package
   * didn't declare one. Same rendering rule as `description` below. */
  displayName: iStringSchema.optional(),
  /** iString: `busabase.json`'s own description may be locale-keyed; render
   * with `iStringParse(value, locale)`, never inserted into JSX directly. */
  description: iStringSchema.default(""),
  version: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type InstallPackageInfoVO = z.infer<typeof InstallPackageInfoVOSchema>;

/** The dry run: what an install would create. Creates nothing. */
export const InstallPlanVOSchema = z.object({
  package: InstallPackageInfoVOSchema,
  /** Resolved GitHub source, echoed back so the UI can show what it actually fetched. */
  source: z.object({
    owner: z.string(),
    repo: z.string(),
    ref: z.string().optional(),
    subdir: z.string().optional(),
  }),
  targetFolderSlug: z.string(),
  nodes: z.array(InstallPlanNodeVOSchema).default([]),
  counts: InstallPlanCountsVOSchema,
  collisions: z.array(InstallCollisionVOSchema).default([]),
  warnings: z.array(z.string()).default([]),
  /**
   * True when a record carries a relation VALUE. A relation stores the ids of the
   * records it points at, and those exist only once the records are merged — so an
   * install left for review would land every relation empty. Such a package cannot
   * be installed by a caller whose content would queue (no write access, or an
   * explicit `autoMerge: false`), and the UI must say why.
   */
  requiresAutoMerge: z.boolean(),
  /**
   * Whether installing with **the options this plan was asked for** would work:
   * false when a collision is unresolved, or when `requiresAutoMerge` is unmet
   * for the `autoMerge` the caller passed.
   *
   * It is therefore an answer to "what happens if I install like this", not a
   * property of the package — a package whose records carry relation values
   * reports `applicable: false` when this caller's content would QUEUE and true
   * when it would merge. Note the plan resolves that the same permission-aware
   * way the install itself does, so omitting `autoMerge` reports what the caller
   * would actually get rather than assuming review. A client that offers an
   * auto-merge toggle must re-plan when it changes (the same way it re-plans when
   * `rename` or `intoFolder` change), rather than treating one plan's
   * `applicable` as final.
   *
   * There is deliberately no `blockedReason` string here: the reason is already
   * carried structurally by `collisions[]` (with `renamedTo`) and
   * `requiresAutoMerge`, and each client words it for its own surface — a CLI
   * says "re-run with --auto-merge", a dialog points at its own checkbox.
   */
  applicable: z.boolean(),
});
export type InstallPlanVO = z.infer<typeof InstallPlanVOSchema>;

export const InstallCreatedCountsVOSchema = z.object({
  folders: z.number().int().min(0),
  docs: z.number().int().min(0),
  bases: z.number().int().min(0),
  views: z.number().int().min(0),
  records: z.number().int().min(0),
  fileTreeNodes: z.number().int().min(0),
  files: z.number().int().min(0),
});
export type InstallCreatedCountsVO = z.infer<typeof InstallCreatedCountsVOSchema>;

export const InstallResultVOSchema = z.object({
  targetFolderSlug: z.string(),
  targetFolderNodeId: z.string(),
  created: InstallCreatedCountsVOSchema,
  /**
   * Change requests left for a human to review. Structure (folders, Bases, their
   * fields and views) is always created immediately — a pending Base has no id, so
   * there would be nowhere to attach a view or a record. Content (records, docs,
   * skills, AirApps) is what lands here for review.
   */
  pendingChangeRequests: z.number().int().min(0),
  warnings: z.array(z.string()).default([]),
});
export type InstallResultVO = z.infer<typeof InstallResultVOSchema>;

/**
 * One event from a streaming install.
 *
 * A whole install in a single response is what makes the plain `fromGithub`
 * route time out at a gateway: the work is minutes of GitHub fetch, node
 * creation, file upload and record writes, and until it finishes the connection
 * carries no bytes. A proxy in front of the app sees an idle socket and closes
 * it — the install itself keeps running server-side, so the user is told it
 * failed while it actually succeeded, which is the worst of both.
 *
 * `applyInstall` already reports its progress (`onProgress`); the non-streaming
 * route simply discarded it. Streaming those same messages keeps bytes moving
 * AND gives the user something truthful to look at during a long install.
 */
export const InstallEventVOSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("progress"),
    /** Human-readable, already localized by the caller's own copy — display as-is. */
    message: z.string(),
  }),
  z.object({
    kind: z.literal("done"),
    result: InstallResultVOSchema,
  }),
]);
export type InstallEventVO = z.infer<typeof InstallEventVOSchema>;

/**
 * What a FAILED install reports, carried as the error's `data`.
 *
 * Structure is created immediately (a pending Base has no id, so there would be
 * nowhere to attach a view or a record), which means a failure partway through
 * leaves real resources behind. Without this the client cannot tell that case
 * apart from "nothing happened" — so it neither refreshes the tree that just
 * changed nor tells the user which folder to look in. The message says the same
 * thing in prose for a human; this is the machine-readable copy.
 */
export const InstallFailureVOSchema = z.object({
  /** Which of the five passes stopped, e.g. `Pass 4/5 (sample records)`. */
  phase: z.string(),
  targetFolderSlug: z.string(),
  created: InstallCreatedCountsVOSchema,
  pendingChangeRequests: z.number().int().min(0),
});
export type InstallFailureVO = z.infer<typeof InstallFailureVOSchema>;

/** True when a failed install left resources in the space. */
export const installFailureTouchedWorkspace = (failure: InstallFailureVO): boolean =>
  Object.values(failure.created).some((count) => count > 0) || failure.pendingChangeRequests > 0;

const repoUrlField = z
  .string()
  .min(1)
  .describe(
    "GitHub repo URL: https://github.com/<owner>/<repo>[/tree/<ref>[/<subdir>]]. Only GitHub hosts are accepted.",
  );

const intoFolderField = z
  .string()
  .optional()
  .describe("Slug of the folder to install into. Defaults to the package manifest's name.");

const renameField = z
  .boolean()
  .optional()
  .describe(
    "Resolve slug collisions by suffixing (-2, -3, …) instead of refusing. Never overwrites anything.",
  );

export const InstallPlanFromGithubDTOSchema = z.object({
  repoUrl: repoUrlField,
  intoFolder: intoFolderField,
  rename: renameField,
  /**
   * Plan as if installing with auto-merge. Only affects the returned
   * `applicable` (see `InstallPlanVOSchema`) — a dry run never writes either
   * way. A client with an auto-merge toggle passes the toggle's current value so
   * the preview answers the question the user is actually about to ask.
   *
   * `.optional()` with no `.default()`, matching `rename` above: `z.infer` gives
   * the OUTPUT type, so a default would make this REQUIRED for every caller.
   * Omitted means "plan without auto-merge" (applied in the logic layer).
   */
  autoMerge: z.boolean().optional(),
});
export type InstallPlanFromGithubDTO = z.infer<typeof InstallPlanFromGithubDTOSchema>;

export const InstallFromGithubDTOSchema = z.object({
  repoUrl: repoUrlField,
  intoFolder: intoFolderField,
  rename: renameField,
  autoMerge: z
    .boolean()
    .optional()
    .describe(
      "Whether the package's content change requests merge on the spot. Omitted defaults to merging immediately when the caller holds write access (installing is already a space owner/admin operation, so normally they do), otherwise leaving them for review; pass explicit false to force review even with write access. Either way, installing trusts the package author: a package can carry skills and AirApps, i.e. code this space's agents will execute.",
    ),
});
export type InstallFromGithubDTO = z.infer<typeof InstallFromGithubDTOSchema>;
