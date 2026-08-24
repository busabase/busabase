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
import { z } from "zod";
/** Every node type the package format can install, as it appears in a plan outline. */
export declare const InstallPlanNodeTypeSchema: z.ZodEnum<{
  airapp: "airapp";
  base: "base";
  doc: "doc";
  drive: "drive";
  file: "file";
  folder: "folder";
  skill: "skill";
}>;
export type InstallPlanNodeType = z.infer<typeof InstallPlanNodeTypeSchema>;
/**
 * One line of the plan's node outline. Flat rather than recursive: `depth` carries
 * the nesting, which renders as a tree without a recursive zod schema (and without
 * the `z.lazy` that a recursive VO would force on every client).
 */
export declare const InstallPlanNodeVOSchema: z.ZodObject<
  {
    path: z.ZodString;
    slug: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<{
      airapp: "airapp";
      base: "base";
      doc: "doc";
      drive: "drive";
      file: "file";
      folder: "folder";
      skill: "skill";
    }>;
    depth: z.ZodNumber;
    fieldCount: z.ZodOptional<z.ZodNumber>;
    recordCount: z.ZodOptional<z.ZodNumber>;
    fileCount: z.ZodOptional<z.ZodNumber>;
  },
  z.core.$strip
>;
export type InstallPlanNodeVO = z.infer<typeof InstallPlanNodeVOSchema>;
/**
 * A slug already taken in the target. `kind` matters: node slugs are unique per
 * PARENT, base slugs per SPACE — so a base can collide from a completely
 * different folder.
 */
export declare const InstallCollisionVOSchema: z.ZodObject<
  {
    kind: z.ZodEnum<{
      base: "base";
      node: "node";
    }>;
    slug: z.ZodString;
    path: z.ZodString;
    renamedTo: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type InstallCollisionVO = z.infer<typeof InstallCollisionVOSchema>;
export declare const InstallPlanCountsVOSchema: z.ZodObject<
  {
    folders: z.ZodNumber;
    docs: z.ZodNumber;
    bases: z.ZodNumber;
    records: z.ZodNumber;
    skills: z.ZodNumber;
    airapps: z.ZodNumber;
    drives: z.ZodNumber;
    files: z.ZodNumber;
  },
  z.core.$strip
>;
export type InstallPlanCountsVO = z.infer<typeof InstallPlanCountsVOSchema>;
/** The package's own metadata, as declared in its `busabase.json`. */
export declare const InstallPackageInfoVOSchema: z.ZodObject<
  {
    name: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    version: z.ZodOptional<z.ZodString>;
    author: z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
    homepage: z.ZodOptional<z.ZodString>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
  },
  z.core.$strip
>;
export type InstallPackageInfoVO = z.infer<typeof InstallPackageInfoVOSchema>;
/** The dry run: what an install would create. Creates nothing. */
export declare const InstallPlanVOSchema: z.ZodObject<
  {
    package: z.ZodObject<
      {
        name: z.ZodString;
        description: z.ZodDefault<z.ZodString>;
        version: z.ZodOptional<z.ZodString>;
        author: z.ZodOptional<z.ZodString>;
        license: z.ZodOptional<z.ZodString>;
        homepage: z.ZodOptional<z.ZodString>;
        tags: z.ZodDefault<z.ZodArray<z.ZodString>>;
      },
      z.core.$strip
    >;
    source: z.ZodObject<
      {
        owner: z.ZodString;
        repo: z.ZodString;
        ref: z.ZodOptional<z.ZodString>;
        subdir: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >;
    targetFolderSlug: z.ZodString;
    nodes: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            path: z.ZodString;
            slug: z.ZodString;
            name: z.ZodString;
            type: z.ZodEnum<{
              airapp: "airapp";
              base: "base";
              doc: "doc";
              drive: "drive";
              file: "file";
              folder: "folder";
              skill: "skill";
            }>;
            depth: z.ZodNumber;
            fieldCount: z.ZodOptional<z.ZodNumber>;
            recordCount: z.ZodOptional<z.ZodNumber>;
            fileCount: z.ZodOptional<z.ZodNumber>;
          },
          z.core.$strip
        >
      >
    >;
    counts: z.ZodObject<
      {
        folders: z.ZodNumber;
        docs: z.ZodNumber;
        bases: z.ZodNumber;
        records: z.ZodNumber;
        skills: z.ZodNumber;
        airapps: z.ZodNumber;
        drives: z.ZodNumber;
        files: z.ZodNumber;
      },
      z.core.$strip
    >;
    collisions: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            kind: z.ZodEnum<{
              base: "base";
              node: "node";
            }>;
            slug: z.ZodString;
            path: z.ZodString;
            renamedTo: z.ZodOptional<z.ZodString>;
          },
          z.core.$strip
        >
      >
    >;
    warnings: z.ZodDefault<z.ZodArray<z.ZodString>>;
    requiresAutoMerge: z.ZodBoolean;
    applicable: z.ZodBoolean;
  },
  z.core.$strip
>;
export type InstallPlanVO = z.infer<typeof InstallPlanVOSchema>;
export declare const InstallCreatedCountsVOSchema: z.ZodObject<
  {
    folders: z.ZodNumber;
    docs: z.ZodNumber;
    bases: z.ZodNumber;
    views: z.ZodNumber;
    records: z.ZodNumber;
    fileTreeNodes: z.ZodNumber;
    files: z.ZodNumber;
  },
  z.core.$strip
>;
export type InstallCreatedCountsVO = z.infer<typeof InstallCreatedCountsVOSchema>;
export declare const InstallResultVOSchema: z.ZodObject<
  {
    targetFolderSlug: z.ZodString;
    targetFolderNodeId: z.ZodString;
    created: z.ZodObject<
      {
        folders: z.ZodNumber;
        docs: z.ZodNumber;
        bases: z.ZodNumber;
        views: z.ZodNumber;
        records: z.ZodNumber;
        fileTreeNodes: z.ZodNumber;
        files: z.ZodNumber;
      },
      z.core.$strip
    >;
    pendingChangeRequests: z.ZodNumber;
    warnings: z.ZodDefault<z.ZodArray<z.ZodString>>;
  },
  z.core.$strip
>;
export type InstallResultVO = z.infer<typeof InstallResultVOSchema>;
export declare const InstallPlanFromGithubDTOSchema: z.ZodObject<
  {
    repoUrl: z.ZodString;
    intoFolder: z.ZodOptional<z.ZodString>;
    rename: z.ZodOptional<z.ZodBoolean>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type InstallPlanFromGithubDTO = z.infer<typeof InstallPlanFromGithubDTOSchema>;
export declare const InstallFromGithubDTOSchema: z.ZodObject<
  {
    repoUrl: z.ZodString;
    intoFolder: z.ZodOptional<z.ZodString>;
    rename: z.ZodOptional<z.ZodBoolean>;
    autoMerge: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type InstallFromGithubDTO = z.infer<typeof InstallFromGithubDTOSchema>;
