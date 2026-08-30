/**
 * `SKILL.md` frontmatter — the generic shape, independent of Busabase.
 *
 * This used to live inside `domains/package/template.ts`, which encoded an
 * assumption that no longer holds: that a Skill is a *part of* a template. Most
 * Skills are not. A Skill is a directory with a `SKILL.md` an agent reads; it
 * needs no `busabase.json`, ships no `content/`, and never installs into a
 * workspace. Busabase's own `busabase-app-creator` is one.
 *
 * Modelling it only as a template component meant there was nowhere to hang
 * checks for a plain Skill, so there were none. Hence its own file, in the
 * domain it belongs to.
 *
 * `metadata` is deliberately open: a Skill carries whatever its ecosystem
 * defines (categories, tags, risk labels, per-agent hints). The Busabase-specific
 * block that decides template-ness is layered on in `domains/package/template.ts`
 * — the template format knows about Skills, not the other way round.
 */
import { z } from "zod";

/** The entry file that makes a directory a Skill. */
export const SKILL_ENTRY_FILE = "SKILL.md";

/**
 * Directories carried alongside `SKILL.md` and installed with it.
 *
 * Not arbitrary: an agent follows what the manual says, and the manual routinely
 * points at `references/…` for detail it deliberately did not inline. A reference
 * that does not travel with the file turns into an instruction the agent cannot
 * satisfy.
 */
export const SKILL_SIDECAR_DIRS: readonly string[] = ["references", "agents", "scripts"];

export const SkillFrontmatterSchema = z.object({
  /** Identity. For a Skill inside a package this must equal the package name. */
  name: z.string().min(1),
  /**
   * How an agent decides whether to reach for this Skill at all — so an empty one
   * is not a cosmetic omission, it is a Skill that never gets picked.
   */
  description: z.string().default(""),
  metadata: z.object({}).passthrough().optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
