/**
 * Template Center catalog types (pure zod, client-safe).
 *
 * The catalog is the file `busabase-cli index` builds from a skills repository
 * — see `busabase-package/index-build`. Most shapes are re-declared here rather
 * than imported because that module is Node-only (it reads packages) and these
 * are rendered in a browser; `TemplateRiskLevelSchema` is the one exception,
 * imported from the package domain because it is already pure zod and a third
 * copy of the same enum is a worse outcome than the cross-domain import.
 *
 * Spec: `apps/busabase/content/spec/template-center.md` §6.4.
 */
import { iStringSchema } from "openlib/i18n/i-string";
import { z } from "zod";
import { TemplateRiskLevelSchema } from "../package/template";

export const TemplateStatsVOSchema = z.object({
  folders: z.number().int(),
  docs: z.number().int(),
  bases: z.number().int(),
  records: z.number().int(),
  files: z.number().int(),
  airapps: z.number().int(),
  skill: z.boolean(),
});
export type TemplateStatsVO = z.infer<typeof TemplateStatsVOSchema>;

export const TemplateCardVOSchema = z.object({
  /** Stable across a catalog: `<repo>/<subdir>`. What a route keys on. */
  id: z.string(),
  /**
   * The package's identity/slug — route key, install-folder name, CLI sort
   * key. Deliberately plain string, never iString: see the long comment on
   * `PackageManifestSchema.name` in the package domain (re-declared here per
   * this file's own convention, not imported, but the reasoning is shared).
   */
  name: z.string(),
  /**
   * Optional human-facing card title, shown instead of `name` — never for
   * identity, `name` still keys the route/install-folder/CLI sort. Absent
   * when the author didn't declare one; the card then falls back to `name`.
   */
  displayName: iStringSchema.optional(),
  /** The catalog card's blurb. iString: `busabase.json`'s own description can
   * be locale-keyed (`{ en: "...", "zh-CN": "..." }`); a plain string is still
   * valid forever. */
  description: iStringSchema,
  category: z.string(),
  /** Absent when undeclared or unrecognized — the card shows "undeclared", never a guess. */
  risk: TemplateRiskLevelSchema.optional(),
  tags: z.array(z.string()).default([]),
  /**
   * Absolute URLs, resolved server-side.
   *
   * The catalog stores package-relative paths; turning them into URLs needs to
   * know the repo and ref, which the server already has and the browser would
   * otherwise have to re-derive. Doing it once here also means a card cannot
   * accidentally point at a different ref than the one it installs.
   */
  screenshots: z.array(z.string()).default([]),
  /**
   * Absolute URL of the demo clip, or absent. Resolved against a different host
   * than the screenshots — see `videoUrl` in the catalog logic.
   */
  video: z.string().optional(),
  agentPrompts: z.array(z.string()).default([]),
  version: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  stats: TemplateStatsVOSchema,
  /** Exactly what the install dialog needs — no URL assembly in the client. */
  install: z.object({
    repoUrl: z.string(),
    intoFolder: z.string(),
  }),
  /** Where a curious user goes to read it before installing. */
  sourceUrl: z.string(),
});
export type TemplateCardVO = z.infer<typeof TemplateCardVOSchema>;

export const TemplateCatalogVOSchema = z.object({
  templates: z.array(TemplateCardVOSchema),
  /** `owner/repo` and ref the catalog was built from — shown as provenance. */
  repo: z.string(),
  ref: z.string(),
  /**
   * Why the catalog is empty or stale, in the server's own words.
   *
   * A gallery that silently shows nothing is indistinguishable from one that is
   * broken, and the difference matters: "the catalog could not be fetched" is a
   * thing a user can act on, "no templates" is not.
   */
  error: z.string().optional(),
});
export type TemplateCatalogVO = z.infer<typeof TemplateCatalogVOSchema>;

export const ListTemplatesDTOSchema = z
  .object({
    refresh: z
      .boolean()
      .optional()
      .describe(
        "Bypass the cache and re-fetch the catalogue — what the refresh button does. " +
          "Slower; leave it off for ordinary reads.",
      ),
  })
  .optional()
  .default({});
export type ListTemplatesDTO = z.infer<typeof ListTemplatesDTOSchema>;
