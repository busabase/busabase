/**
 * Dump domain oRPC routes — full-fidelity raw-row export/import used by the
 * `busabase-dump` CLI package's "full" fidelity mode. Composed into the root
 * contract in `contract/busabase.ts` under the `dump` key. Every route is
 * space-context-scoped (the space comes from the request's auth context, same
 * as every other kernel/domain route — never a client-supplied spaceId) and is
 * intended to be gated to admin-level API keys by the host (mirrors how other
 * sensitive kernel surfaces like `vault` are host-gated; busabase-core itself
 * stays host-agnostic and applies no auth).
 */
export declare const dumpContract: {
  exportTables: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    import("zod").ZodObject<
      {
        table: import("zod").ZodEnum<{
          assetTexts: "assetTexts";
          assetUsages: "assetUsages";
          assets: "assets";
          attachments: "attachments";
          auditEvents: "auditEvents";
          baseFields: "baseFields";
          bases: "bases";
          changeRequests: "changeRequests";
          comments: "comments";
          commits: "commits";
          fieldValues: "fieldValues";
          nodePrincipals: "nodePrincipals";
          nodes: "nodes";
          operations: "operations";
          recordLinks: "recordLinks";
          records: "records";
          reviews: "reviews";
          views: "views";
        }>;
        cursor: import("zod").ZodOptional<import("zod").ZodString>;
        limit: import("zod").ZodDefault<import("zod").ZodOptional<import("zod").ZodNumber>>;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        rows: import("zod").ZodArray<
          import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>
        >;
        nextCursor: import("zod").ZodNullable<import("zod").ZodString>;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  exportAssetText: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    import("zod").ZodObject<
      {
        assetId: import("zod").ZodString;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        assetId: import("zod").ZodString;
        textStorageKey: import("zod").ZodString;
        downloadUrl: import("zod").ZodNullable<import("zod").ZodString>;
        textContentHash: import("zod").ZodNullable<import("zod").ZodString>;
        byteCount: import("zod").ZodNumber;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  importBegin: import("@orpc/contract").ContractProcedureBuilderWithOutput<
    import("@orpc/contract").Schema<unknown, unknown>,
    import("zod").ZodObject<
      {
        sessionId: import("zod").ZodString;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  importTables: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    import("zod").ZodObject<
      {
        sessionId: import("zod").ZodString;
        table: import("zod").ZodUnion<
          readonly [
            import("zod").ZodEnum<{
              assetTexts: "assetTexts";
              assetUsages: "assetUsages";
              assets: "assets";
              attachments: "attachments";
              auditEvents: "auditEvents";
              baseFields: "baseFields";
              bases: "bases";
              changeRequests: "changeRequests";
              comments: "comments";
              commits: "commits";
              fieldValues: "fieldValues";
              nodePrincipals: "nodePrincipals";
              nodes: "nodes";
              operations: "operations";
              recordLinks: "recordLinks";
              records: "records";
              reviews: "reviews";
              views: "views";
            }>,
            import("zod").ZodLiteral<"docBodies">,
            import("zod").ZodLiteral<"attachmentBlobs">,
            import("zod").ZodLiteral<"assetTextBlobs">,
          ]
        >;
        rows: import("zod").ZodArray<
          import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>
        >;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        inserted: import("zod").ZodNumber;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  importCommit: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    import("zod").ZodObject<
      {
        sessionId: import("zod").ZodString;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        ok: import("zod").ZodBoolean;
        warnings: import("zod").ZodArray<import("zod").ZodString>;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  importAbort: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    import("zod").ZodObject<
      {
        sessionId: import("zod").ZodString;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        ok: import("zod").ZodBoolean;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
};
