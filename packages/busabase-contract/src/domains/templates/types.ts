/**
 * Template Center catalog types (pure zod, client-safe).
 *
 * The catalog is the file `busabase-cli index` builds from a skills repository
 * — see `busabase-package/index-build`. It is re-declared here rather than
 * imported because that module is Node-only (it reads packages), and these
 * shapes are rendered in a browser.
 *
 * Spec: `apps/busabase/content/spec/template-center.md` §6.4.
 */
import { z } from "zod";

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
  name: z.string(),
  description: z.string(),
  category: z.string(),
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
    /** Bypass the cache — the refresh button. */
    refresh: z.boolean().optional(),
  })
  .optional()
  .default({});
export type ListTemplatesDTO = z.infer<typeof ListTemplatesDTOSchema>;
