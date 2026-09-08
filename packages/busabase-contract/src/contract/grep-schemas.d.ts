/**
 * Unified Grep (files + node content + records) — top-level, domain-agnostic
 * schemas for `POST /grep`.
 *
 * Mirrors how `search`'s schemas live top-level in `contract/schemas.ts`
 * rather than inside a single domain's contract: `grep` composes multiple
 * domains (files, node content, Base records), so its schemas belong at the same
 * level as `search`'s, not inside `domains/assets/` or `domains/base/`.
 * The internal files scanner and SDK compatibility adapter keep files-only
 * schemas in `domains/assets/types.ts`. This file intentionally reuses only
 * their numeric default/cap constants (same budget language), never their
 * type names (which would collide: `GrepMatchVO` vs `UnifiedGrepMatchVO`).
 *
 * Pure zod — no logic/db imports (client-safe: pulled into the browser
 * bundle and the RN oRPC client's type graph).
 */
import { z } from "zod";
/**
 * Sources Unified Grep can scan. `"records"` (P2b) scans canonical Base
 * record commits (`headCommit.payload`) — never the truncated
 * `busabase_field_values` search projection, per the spec's decision record
 * on why that projection can't back grep.
 */
/**
 * BREAKING (renamed from "docs" in 0.18.0): this source scans the content of
 * EVERY node type that stores a content object — `doc`, `html`, `whiteboard`
 * and `workflow` — not just Docs. The old name described the only type that
 * had been implemented, not the category, and kept the other three silently
 * unsearchable. Narrow with `scope.nodes.types` to get the old doc-only
 * behaviour back explicitly.
 */
export declare const GrepSourceSchema: z.ZodEnum<{
  files: "files";
  nodes: "nodes";
  records: "records";
}>;
export type GrepSource = z.infer<typeof GrepSourceSchema>;
/** Files scope — identical shape to the internal files scanner's `GrepScopeSchema`. */
export declare const UnifiedGrepFilesScopeSchema: z.ZodObject<
  {
    assetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    drivePath: z.ZodOptional<z.ZodString>;
    mimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
  },
  z.core.$strip
>;
export type UnifiedGrepFilesScope = z.infer<typeof UnifiedGrepFilesScopeSchema>;
/** Node-content scope — narrow by node id and/or node type; omitted scans every non-archived node that has content. */
export declare const SearchableNodeTypeSchema: z.ZodEnum<{
  doc: "doc";
  html: "html";
  whiteboard: "whiteboard";
  workflow: "workflow";
}>;
export type SearchableNodeType = z.infer<typeof SearchableNodeTypeSchema>;
export declare const UnifiedGrepNodesScopeSchema: z.ZodObject<
  {
    nodeIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    types: z.ZodOptional<
      z.ZodArray<
        z.ZodEnum<{
          doc: "doc";
          html: "html";
          whiteboard: "whiteboard";
          workflow: "workflow";
        }>
      >
    >;
  },
  z.core.$strip
>;
export type UnifiedGrepNodesScope = z.infer<typeof UnifiedGrepNodesScopeSchema>;
/**
 * Records scope — narrow to specific Bases by id and/or slug (union
 * semantics: a Base is in scope if it matches EITHER list — giving both is
 * not an intersection). Omitted scans every non-archived Base's active
 * records in the current space.
 */
export declare const UnifiedGrepRecordsScopeSchema: z.ZodObject<
  {
    baseIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    baseSlugs: z.ZodOptional<z.ZodArray<z.ZodString>>;
  },
  z.core.$strip
>;
export type UnifiedGrepRecordsScope = z.infer<typeof UnifiedGrepRecordsScopeSchema>;
export declare const UnifiedGrepScopeSchema: z.ZodObject<
  {
    files: z.ZodOptional<
      z.ZodObject<
        {
          assetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
          drivePath: z.ZodOptional<z.ZodString>;
          mimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
        },
        z.core.$strip
      >
    >;
    nodes: z.ZodOptional<
      z.ZodObject<
        {
          nodeIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
          types: z.ZodOptional<
            z.ZodArray<
              z.ZodEnum<{
                doc: "doc";
                html: "html";
                whiteboard: "whiteboard";
                workflow: "workflow";
              }>
            >
          >;
        },
        z.core.$strip
      >
    >;
    records: z.ZodOptional<
      z.ZodObject<
        {
          baseIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
          baseSlugs: z.ZodOptional<z.ZodArray<z.ZodString>>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type UnifiedGrepScope = z.infer<typeof UnifiedGrepScopeSchema>;
export declare const UnifiedGrepInputSchema: z.ZodObject<
  {
    pattern: z.ZodString;
    flags: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    sources: z.ZodOptional<
      z.ZodArray<
        z.ZodEnum<{
          files: "files";
          nodes: "nodes";
          records: "records";
        }>
      >
    >;
    scope: z.ZodOptional<
      z.ZodObject<
        {
          files: z.ZodOptional<
            z.ZodObject<
              {
                assetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                drivePath: z.ZodOptional<z.ZodString>;
                mimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
              },
              z.core.$strip
            >
          >;
          nodes: z.ZodOptional<
            z.ZodObject<
              {
                nodeIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                types: z.ZodOptional<
                  z.ZodArray<
                    z.ZodEnum<{
                      doc: "doc";
                      html: "html";
                      whiteboard: "whiteboard";
                      workflow: "workflow";
                    }>
                  >
                >;
              },
              z.core.$strip
            >
          >;
          records: z.ZodOptional<
            z.ZodObject<
              {
                baseIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                baseSlugs: z.ZodOptional<z.ZodArray<z.ZodString>>;
              },
              z.core.$strip
            >
          >;
        },
        z.core.$strip
      >
    >;
    maxMatches: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    contextLines: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
  },
  z.core.$strip
>;
/** Caller input before Zod applies grep defaults. */
export type UnifiedGrepInputDTO = z.input<typeof UnifiedGrepInputSchema>;
/** Parsed input consumed by unified grep logic. */
export type UnifiedGrepInput = z.infer<typeof UnifiedGrepInputSchema>;
export declare const UnifiedGrepFileMatchVOSchema: z.ZodObject<
  {
    line: z.ZodNumber;
    column: z.ZodNumber;
    text: z.ZodString;
    before: z.ZodArray<z.ZodString>;
    after: z.ZodArray<z.ZodString>;
    source: z.ZodLiteral<"files">;
    assetId: z.ZodString;
    fileName: z.ZodString;
    drivePath: z.ZodString;
  },
  z.core.$strip
>;
export type UnifiedGrepFileMatchVO = z.infer<typeof UnifiedGrepFileMatchVOSchema>;
export declare const UnifiedGrepNodeMatchVOSchema: z.ZodObject<
  {
    line: z.ZodNumber;
    column: z.ZodNumber;
    text: z.ZodString;
    before: z.ZodArray<z.ZodString>;
    after: z.ZodArray<z.ZodString>;
    source: z.ZodLiteral<"nodes">;
    type: z.ZodEnum<{
      doc: "doc";
      html: "html";
      whiteboard: "whiteboard";
      workflow: "workflow";
    }>;
    nodeId: z.ZodString;
    slug: z.ZodString;
    name: z.ZodString;
  },
  z.core.$strip
>;
export type UnifiedGrepNodeMatchVO = z.infer<typeof UnifiedGrepNodeMatchVOSchema>;
export declare const UnifiedGrepRecordMatchVOSchema: z.ZodObject<
  {
    line: z.ZodNumber;
    column: z.ZodNumber;
    text: z.ZodString;
    before: z.ZodArray<z.ZodString>;
    after: z.ZodArray<z.ZodString>;
    source: z.ZodLiteral<"records">;
    baseId: z.ZodString;
    baseSlug: z.ZodString;
    recordId: z.ZodString;
    fieldSlug: z.ZodString;
  },
  z.core.$strip
>;
export type UnifiedGrepRecordMatchVO = z.infer<typeof UnifiedGrepRecordMatchVOSchema>;
export declare const UnifiedGrepMatchVOSchema: z.ZodDiscriminatedUnion<
  [
    z.ZodObject<
      {
        line: z.ZodNumber;
        column: z.ZodNumber;
        text: z.ZodString;
        before: z.ZodArray<z.ZodString>;
        after: z.ZodArray<z.ZodString>;
        source: z.ZodLiteral<"files">;
        assetId: z.ZodString;
        fileName: z.ZodString;
        drivePath: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        line: z.ZodNumber;
        column: z.ZodNumber;
        text: z.ZodString;
        before: z.ZodArray<z.ZodString>;
        after: z.ZodArray<z.ZodString>;
        source: z.ZodLiteral<"nodes">;
        type: z.ZodEnum<{
          doc: "doc";
          html: "html";
          whiteboard: "whiteboard";
          workflow: "workflow";
        }>;
        nodeId: z.ZodString;
        slug: z.ZodString;
        name: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        line: z.ZodNumber;
        column: z.ZodNumber;
        text: z.ZodString;
        before: z.ZodArray<z.ZodString>;
        after: z.ZodArray<z.ZodString>;
        source: z.ZodLiteral<"records">;
        baseId: z.ZodString;
        baseSlug: z.ZodString;
        recordId: z.ZodString;
        fieldSlug: z.ZodString;
      },
      z.core.$strip
    >,
  ],
  "source"
>;
export type UnifiedGrepMatchVO = z.infer<typeof UnifiedGrepMatchVOSchema>;
/** Honest files coverage preserved from the original files-only scanner. */
export declare const UnifiedGrepFilesCoverageSchema: z.ZodObject<
  {
    scanned: z.ZodNumber;
    missing: z.ZodArray<z.ZodString>;
    stale: z.ZodArray<z.ZodString>;
    unsearchable: z.ZodNumber;
    errored: z.ZodArray<z.ZodString>;
    notReached: z.ZodNumber;
  },
  z.core.$strip
>;
export type UnifiedGrepFilesCoverage = z.infer<typeof UnifiedGrepFilesCoverageSchema>;
/** Node-content coverage — simpler than files' (no missing/stale/unsearchable concept for a storage-native node body). */
export declare const UnifiedGrepNodesCoverageSchema: z.ZodObject<
  {
    scanned: z.ZodNumber;
    errored: z.ZodArray<z.ZodString>;
    notReached: z.ZodNumber;
  },
  z.core.$strip
>;
export type UnifiedGrepNodesCoverage = z.infer<typeof UnifiedGrepNodesCoverageSchema>;
/** Records coverage — same simple shape as nodes' (no missing/stale/unsearchable concept for canonical commit data). */
export declare const UnifiedGrepRecordsCoverageSchema: z.ZodObject<
  {
    scanned: z.ZodNumber;
    errored: z.ZodArray<z.ZodString>;
    notReached: z.ZodNumber;
  },
  z.core.$strip
>;
export type UnifiedGrepRecordsCoverage = z.infer<typeof UnifiedGrepRecordsCoverageSchema>;
export declare const UnifiedGrepCoverageSchema: z.ZodObject<
  {
    files: z.ZodObject<
      {
        scanned: z.ZodNumber;
        missing: z.ZodArray<z.ZodString>;
        stale: z.ZodArray<z.ZodString>;
        unsearchable: z.ZodNumber;
        errored: z.ZodArray<z.ZodString>;
        notReached: z.ZodNumber;
      },
      z.core.$strip
    >;
    nodes: z.ZodObject<
      {
        scanned: z.ZodNumber;
        errored: z.ZodArray<z.ZodString>;
        notReached: z.ZodNumber;
      },
      z.core.$strip
    >;
    records: z.ZodObject<
      {
        scanned: z.ZodNumber;
        errored: z.ZodArray<z.ZodString>;
        notReached: z.ZodNumber;
      },
      z.core.$strip
    >;
  },
  z.core.$strip
>;
export type UnifiedGrepCoverage = z.infer<typeof UnifiedGrepCoverageSchema>;
export declare const UnifiedGrepResultVOSchema: z.ZodObject<
  {
    matches: z.ZodArray<
      z.ZodDiscriminatedUnion<
        [
          z.ZodObject<
            {
              line: z.ZodNumber;
              column: z.ZodNumber;
              text: z.ZodString;
              before: z.ZodArray<z.ZodString>;
              after: z.ZodArray<z.ZodString>;
              source: z.ZodLiteral<"files">;
              assetId: z.ZodString;
              fileName: z.ZodString;
              drivePath: z.ZodString;
            },
            z.core.$strip
          >,
          z.ZodObject<
            {
              line: z.ZodNumber;
              column: z.ZodNumber;
              text: z.ZodString;
              before: z.ZodArray<z.ZodString>;
              after: z.ZodArray<z.ZodString>;
              source: z.ZodLiteral<"nodes">;
              type: z.ZodEnum<{
                doc: "doc";
                html: "html";
                whiteboard: "whiteboard";
                workflow: "workflow";
              }>;
              nodeId: z.ZodString;
              slug: z.ZodString;
              name: z.ZodString;
            },
            z.core.$strip
          >,
          z.ZodObject<
            {
              line: z.ZodNumber;
              column: z.ZodNumber;
              text: z.ZodString;
              before: z.ZodArray<z.ZodString>;
              after: z.ZodArray<z.ZodString>;
              source: z.ZodLiteral<"records">;
              baseId: z.ZodString;
              baseSlug: z.ZodString;
              recordId: z.ZodString;
              fieldSlug: z.ZodString;
            },
            z.core.$strip
          >,
        ],
        "source"
      >
    >;
    coverage: z.ZodObject<
      {
        files: z.ZodObject<
          {
            scanned: z.ZodNumber;
            missing: z.ZodArray<z.ZodString>;
            stale: z.ZodArray<z.ZodString>;
            unsearchable: z.ZodNumber;
            errored: z.ZodArray<z.ZodString>;
            notReached: z.ZodNumber;
          },
          z.core.$strip
        >;
        nodes: z.ZodObject<
          {
            scanned: z.ZodNumber;
            errored: z.ZodArray<z.ZodString>;
            notReached: z.ZodNumber;
          },
          z.core.$strip
        >;
        records: z.ZodObject<
          {
            scanned: z.ZodNumber;
            errored: z.ZodArray<z.ZodString>;
            notReached: z.ZodNumber;
          },
          z.core.$strip
        >;
      },
      z.core.$strip
    >;
    truncated: z.ZodBoolean;
  },
  z.core.$strip
>;
export type UnifiedGrepResultVO = z.infer<typeof UnifiedGrepResultVOSchema>;
