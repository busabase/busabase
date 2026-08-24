/**
 * Template extension of the `busabase-package@1` format (pure zod, client-safe).
 *
 * A **template** is a package that is ALSO an Agent Skill: the same directory
 * carries a root `SKILL.md` (what an agent reads) next to `busabase.json` +
 * `content/` (what installs into a space). Nothing under `content/` changes —
 * the whole increment lives OUTSIDE it:
 *
 *   my-app/
 *   ├── SKILL.md          ← root skill entry (+ references/ agents/ scripts/)
 *   ├── busabase.json     ← manifest, now with an optional `template` object
 *   └── content/          ← byte-identical to a plain busabase-package@1 tree
 *
 * Consequences worth stating once, because they are what make the format
 * "multiplexed" rather than a second format:
 *   - A template directory is already a VALID package. Today's `install` can
 *     install it (it just won't land the Skill node, stamp ownership, or merge
 *     the sample records).
 *   - Any package becomes a template by adding a root `SKILL.md` plus the
 *     `template` object — no migration, no v2.
 *   - `export --template` emits a `content/` byte-identical to plain `export`.
 *
 * See `apps/busabase/content/spec/template-center.md` (§5, §6.2a, §13).
 */
import { z } from "zod";

// ── Layout constants (all OUTSIDE `content/`) ────────────────────────────────

/**
 * The root skill entry file. Deliberately the same name a `skill` NODE uses as
 * its entry file, because it becomes exactly that on install: the reader lifts
 * it (plus the sidecar dirs below) into a `skill` node inside the target
 * folder, so the manual travels with the resources instead of staying on the
 * publisher's disk.
 */
export const PACKAGE_SKILL_ENTRY = "SKILL.md";

/**
 * Directories carried into the Skill node alongside `SKILL.md`.
 *
 * `scripts/` is included on purpose even though Busabase never executes it: the
 * Skill node is a file tree, a shell agent that pulls the skill back out gets a
 * working copy, and dropping the scripts would make the round-trip lossy. The
 * safety property comes from *nothing in Busabase running them*, not from
 * refusing to store them.
 */
export const PACKAGE_SKILL_SIDECAR_DIRS: readonly string[] = ["references", "agents", "scripts"];

/**
 * Per-AirApp ignore file (gitignore syntax), read at
 * `content/<airapp>/.busabaseignore`.
 *
 * An AirApp node IS the project — nodepod runs `npm run dev` against it — so the
 * package cannot simply carry "the deployable subset" as a separate copy without
 * reintroducing the two-sources-of-truth problem the template format exists to
 * remove. The ignore file lets one directory be both: the repo keeps `test/`,
 * lockfiles and coverage; the node receives only what has to run.
 *
 * `package.json` and the entry it declares can never be ignored — a validator
 * error rather than a warning, because the resulting AirApp would install fine
 * and then fail to boot, which is the failure mode hardest to attribute.
 */
export const PACKAGE_AIRAPP_IGNORE = ".busabaseignore";

/** Screenshots for the Template Center card/detail. Not nodes; never installed. */
export const PACKAGE_SCREENSHOTS_DIRNAME = "assets/screenshots";

/**
 * Sample-record ceiling per Base, enforced by the validator.
 *
 * Templates merge their sample records on install (§13.6) so the app is not
 * empty on first open and "Ask agent" has something to act on. That convenience
 * is exactly why the ceiling is low: merged records fire webhooks and
 * automations, enter commit history, and are read by agents as data. A template
 * seeds a demo, it does not ship a dataset.
 */
export const TEMPLATE_MAX_SAMPLE_RECORDS_PER_BASE = 50;

// ── Manifest extension — `busabase.json`'s `template` object ─────────────────

/**
 * Which AirApp "Run"/"open the app" means when a template carries more than one.
 *
 * Roles beyond `primary` are labels for humans and for the agent's benefit
 * ("start the admin panel"); only `primary` has mechanical meaning, and the
 * validator requires exactly one of it. Guessing is deliberately not allowed —
 * see `resolvePrimaryAirApp`.
 */
export const TEMPLATE_AIRAPP_ROLES = ["primary", "admin", "public", "tool"] as const;
export type TemplateAirAppRole = (typeof TEMPLATE_AIRAPP_ROLES)[number];

export const TemplateAirAppRefSchema = z.object({
  /** Slug of the `content/<dir>` holding the AirApp. */
  slug: z.string().min(1),
  role: z.enum(TEMPLATE_AIRAPP_ROLES),
  label: z.string().optional(),
});
export type TemplateAirAppRef = z.infer<typeof TemplateAirAppRefSchema>;

/**
 * Secrets the app expects to find in the Vault.
 *
 * DECLARED, never created: the package format has no slot for secret values and
 * must not grow one (the same "you cannot leak what the format cannot express"
 * rule the whole format is built on). Install surfaces these as a post-install
 * prompt; the user fills them in the Vault themselves.
 */
export const TemplateSecretSchema = z.object({
  key: z.string().min(1),
  description: z.string().default(""),
  required: z.boolean().default(true),
});
export type TemplateSecret = z.infer<typeof TemplateSecretSchema>;

export const TemplateManifestSchema = z.object({
  /** Template Center category, e.g. `"crm"`, `"email"`, `"content"`. */
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  /** Card/detail screenshots, package-relative (`assets/screenshots/overview.webp`). */
  screenshots: z.array(z.string()).default([]),
  /**
   * Ready-made prompts shown after install ("Ask agent" prefills the first).
   *
   * They are the difference between a folder of tables and something a user can
   * *use*: the point of a template is that the agent already knows the job, and
   * these are how that is made visible rather than left for the user to guess.
   */
  agentPrompts: z.array(z.string()).default([]),
  /** Single-AirApp shorthand. Mutually exclusive with `airapps`. */
  airapp: z.string().optional(),
  /** Multi-AirApp form. Exactly one entry must have `role: "primary"`. */
  airapps: z.array(TemplateAirAppRefSchema).optional(),
  /**
   * Bumped by the author when the declared resource shape changes.
   *
   * Part of the ownership stamp, so BOTH doors must agree on it: the installer
   * writes it, and a skill's own `setup.mjs` compares against it to decide
   * whether a node it finds is its own current shape or an older one to repair.
   * Defaulted rather than required so an author who never versions their app
   * still gets a stamp both sides recognise.
   */
  schemaVersion: z.number().int().nonnegative().default(1),
  vaultNamespace: z.string().optional(),
  secrets: z.array(TemplateSecretSchema).default([]),
  requires: z
    .object({
      airapp: z.boolean().optional(),
    })
    .default({}),
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

/**
 * `metadata.busabase` inside the root `SKILL.md`'s YAML frontmatter.
 *
 * `template: true` is an EXPLICIT opt-in, not an inference from "this skill
 * happens to contain a package". Publishing a template means accepting that
 * installers will run its AirApp code and feed its SKILL.md to their agent; that
 * deserves a deliberate flag rather than a side effect of directory shape.
 */
export const SkillBusabaseMetadataSchema = z.object({
  template: z.boolean().default(false),
  folderSlug: z.string().optional(),
  /** Resource keys the manual talks about; each must exist under `content/`. */
  resources: z.array(z.string()).default([]),
  risk: z.string().optional(),
});
export type SkillBusabaseMetadata = z.infer<typeof SkillBusabaseMetadataSchema>;

/** Root `SKILL.md` frontmatter, as far as the template format cares about it. */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  metadata: z
    .object({
      busabase: SkillBusabaseMetadataSchema.optional(),
    })
    .passthrough()
    .optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/**
 * Resolve which AirApp is the app, or explain why it cannot be resolved.
 *
 * Order matters and mirrors §5.4: an explicit declaration always wins, a single
 * candidate is unambiguous enough to accept, and anything else is an error the
 * publisher must resolve. Ambiguity is never resolved by picking the first
 * alphabetically — a template that silently opens the wrong app is worse than
 * one that refuses to publish.
 */
export const resolvePrimaryAirApp = (
  template: TemplateManifest | undefined,
  airAppSlugsInContent: readonly string[],
): { slug: string } | { error: string } => {
  if (template?.airapp && template.airapps?.length) {
    return { error: "`template.airapp` and `template.airapps` are mutually exclusive." };
  }
  if (template?.airapp) {
    return airAppSlugsInContent.includes(template.airapp)
      ? { slug: template.airapp }
      : { error: `template.airapp "${template.airapp}" has no matching AirApp under content/.` };
  }
  if (template?.airapps?.length) {
    const primaries = template.airapps.filter((entry) => entry.role === "primary");
    if (primaries.length !== 1) {
      return {
        error: `template.airapps must declare exactly one entry with role "primary" (found ${primaries.length}).`,
      };
    }
    const [primary] = primaries;
    const unknown = template.airapps.filter((entry) => !airAppSlugsInContent.includes(entry.slug));
    if (unknown.length) {
      return {
        error: `template.airapps references AirApps missing from content/: ${unknown.map((entry) => entry.slug).join(", ")}.`,
      };
    }
    return { slug: primary.slug };
  }
  if (airAppSlugsInContent.length === 1) return { slug: airAppSlugsInContent[0] };
  if (airAppSlugsInContent.length === 0) return { error: "This package contains no AirApp." };
  return {
    error: `content/ has ${airAppSlugsInContent.length} AirApps; declare which one is primary via template.airapp or template.airapps.`,
  };
};

// ── Ownership stamps — how both doors recognise "I already installed this" ───

/**
 * The single definition of the ownership stamp, imported by BOTH writers.
 *
 * Two independent code paths create the same resources: `busabase-package`'s
 * apply (UI / CLI install) and `busabase-sdk`'s `provisionDeclaredResources`
 * (a skill's own `setup.mjs`). They recognise each other's work only by the
 * shape of this stamp — the SDK treats an unstamped-or-differently-stamped node
 * as someone else's and raises `SETUP_CONFLICT`. If the two ever drift, a user
 * who installed from the Template Center and then ran the skill in their shell
 * gets a hard conflict on their own data, which is why this lives in the
 * contract package and neither side is allowed to re-declare it locally.
 */
export const APP_OWNERSHIP_METADATA_KEYS = {
  appId: "appId",
  resourceKey: "resourceKey",
  schemaVersion: "schemaVersion",
} as const;

/** Stamp on every resource node (Base, Drive, AirApp, …) an app owns. */
export const AppResourceOwnershipSchema = z.object({
  appId: z.string().min(1),
  /** Stable internal handle (`"contacts"`), NOT the installed slug. */
  resourceKey: z.string().min(1),
  schemaVersion: z.number().int().nonnegative(),
});
export type AppResourceOwnership = z.infer<typeof AppResourceOwnershipSchema>;

/**
 * The `resourceKey` reserved for an app's root Folder.
 *
 * `busabase-sdk` recognises an app's own Folder by looking for exactly this
 * value (`ownsAppRoot`), so the installer must write it too — a Folder stamped
 * with anything else reads as a stranger's, and the skill's own `setup.mjs`
 * then refuses to touch its own workspace with `SETUP_CONFLICT`. Exported so
 * neither side carries the string literal privately.
 */
export const APP_ROOT_RESOURCE_KEY = "app-root";

/**
 * Stamp on the app's root Folder.
 *
 * Structurally a resource stamp — `appId` + `resourceKey` + `schemaVersion`,
 * because that triple is what the SDK checks — plus install-only extras.
 * `source` is what makes an upgrade offer possible at all (which repo/ref this
 * came from), and `version` is what it is compared against. Node metadata is
 * shallow-merged, so the extras sit alongside the triple rather than replacing
 * it; a `setup.mjs` that never sets them is unaffected.
 */
export const AppRootOwnershipSchema = AppResourceOwnershipSchema.extend({
  resourceKey: z.literal(APP_ROOT_RESOURCE_KEY),
  version: z.string().optional(),
  source: z
    .object({
      repo: z.string().optional(),
      ref: z.string().optional(),
      subdir: z.string().optional(),
    })
    .optional(),
  installedAt: z.string().optional(),
});
export type AppRootOwnership = z.infer<typeof AppRootOwnershipSchema>;

/**
 * Marks the Skill node lifted from the package root.
 *
 * Needed in both directions: export lifts exactly this node back out to the
 * package root instead of writing it under `content/` (which would create the
 * duplicate the format exists to avoid), and the agent wiring lists exactly
 * these nodes as "app manuals available in this space".
 */
export const TEMPLATE_SKILL_METADATA_KEY = "isTemplateSkill";

export const TemplateSkillOwnershipSchema = z.object({
  appId: z.string().min(1),
  [TEMPLATE_SKILL_METADATA_KEY]: z.literal(true),
});
export type TemplateSkillOwnership = z.infer<typeof TemplateSkillOwnershipSchema>;
