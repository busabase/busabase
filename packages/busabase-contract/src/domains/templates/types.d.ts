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
export declare const TemplateStatsVOSchema: z.ZodObject<
  {
    folders: z.ZodNumber;
    docs: z.ZodNumber;
    bases: z.ZodNumber;
    records: z.ZodNumber;
    files: z.ZodNumber;
    airapps: z.ZodNumber;
    skill: z.ZodBoolean;
  },
  z.core.$strip
>;
export type TemplateStatsVO = z.infer<typeof TemplateStatsVOSchema>;
export declare const TemplateCardVOSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    category: z.ZodString;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
    screenshots: z.ZodDefault<z.ZodArray<z.ZodString>>;
    agentPrompts: z.ZodDefault<z.ZodArray<z.ZodString>>;
    version: z.ZodOptional<z.ZodString>;
    author: z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
    stats: z.ZodObject<
      {
        folders: z.ZodNumber;
        docs: z.ZodNumber;
        bases: z.ZodNumber;
        records: z.ZodNumber;
        files: z.ZodNumber;
        airapps: z.ZodNumber;
        skill: z.ZodBoolean;
      },
      z.core.$strip
    >;
    install: z.ZodObject<
      {
        repoUrl: z.ZodString;
        intoFolder: z.ZodString;
      },
      z.core.$strip
    >;
    sourceUrl: z.ZodString;
  },
  z.core.$strip
>;
export type TemplateCardVO = z.infer<typeof TemplateCardVOSchema>;
export declare const TemplateCatalogVOSchema: z.ZodObject<
  {
    templates: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          name: z.ZodString;
          description: z.ZodString;
          category: z.ZodString;
          tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
          screenshots: z.ZodDefault<z.ZodArray<z.ZodString>>;
          agentPrompts: z.ZodDefault<z.ZodArray<z.ZodString>>;
          version: z.ZodOptional<z.ZodString>;
          author: z.ZodOptional<z.ZodString>;
          license: z.ZodOptional<z.ZodString>;
          stats: z.ZodObject<
            {
              folders: z.ZodNumber;
              docs: z.ZodNumber;
              bases: z.ZodNumber;
              records: z.ZodNumber;
              files: z.ZodNumber;
              airapps: z.ZodNumber;
              skill: z.ZodBoolean;
            },
            z.core.$strip
          >;
          install: z.ZodObject<
            {
              repoUrl: z.ZodString;
              intoFolder: z.ZodString;
            },
            z.core.$strip
          >;
          sourceUrl: z.ZodString;
        },
        z.core.$strip
      >
    >;
    repo: z.ZodString;
    ref: z.ZodString;
    error: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type TemplateCatalogVO = z.infer<typeof TemplateCatalogVOSchema>;
export declare const ListTemplatesDTOSchema: z.ZodDefault<
  z.ZodOptional<
    z.ZodObject<
      {
        refresh: z.ZodOptional<z.ZodBoolean>;
      },
      z.core.$strip
    >
  >
>;
export type ListTemplatesDTO = z.infer<typeof ListTemplatesDTOSchema>;
