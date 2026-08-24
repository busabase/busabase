/**
 * Install domain oRPC routes — server-side "Install from GitHub" (spec §15).
 * Composed into the root contract in `contract/busabase.ts` under the `install`
 * key.
 *
 * The server does the whole job (fetch the zipball, validate, plan, apply)
 * because the browser cannot: a cross-origin zipball is blocked by CORS, and
 * letting a client hand the server arbitrary fetch targets is precisely the SSRF
 * hole. So the client only ever sends a URL and renders a plan.
 *
 * Both routes are gated on the space owner/admin role in the logic layer
 * (`logic/_guard.ts`): a package can carry skills and AirApps, i.e. code the
 * space's agents will execute. Installing one is an admin act, not a member act.
 */
export declare const installContract: {
  planFromGithub: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    import("zod").ZodObject<
      {
        repoUrl: import("zod").ZodString;
        intoFolder: import("zod").ZodOptional<import("zod").ZodString>;
        rename: import("zod").ZodOptional<import("zod").ZodBoolean>;
        autoMerge: import("zod").ZodOptional<import("zod").ZodBoolean>;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        package: import("zod").ZodObject<
          {
            name: import("zod").ZodString;
            description: import("zod").ZodDefault<import("zod").ZodString>;
            version: import("zod").ZodOptional<import("zod").ZodString>;
            author: import("zod").ZodOptional<import("zod").ZodString>;
            license: import("zod").ZodOptional<import("zod").ZodString>;
            homepage: import("zod").ZodOptional<import("zod").ZodString>;
            tags: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
          },
          import("zod/v4/core").$strip
        >;
        source: import("zod").ZodObject<
          {
            owner: import("zod").ZodString;
            repo: import("zod").ZodString;
            ref: import("zod").ZodOptional<import("zod").ZodString>;
            subdir: import("zod").ZodOptional<import("zod").ZodString>;
          },
          import("zod/v4/core").$strip
        >;
        targetFolderSlug: import("zod").ZodString;
        nodes: import("zod").ZodDefault<
          import("zod").ZodArray<
            import("zod").ZodObject<
              {
                path: import("zod").ZodString;
                slug: import("zod").ZodString;
                name: import("zod").ZodString;
                type: import("zod").ZodEnum<{
                  airapp: "airapp";
                  base: "base";
                  doc: "doc";
                  drive: "drive";
                  file: "file";
                  folder: "folder";
                  skill: "skill";
                }>;
                depth: import("zod").ZodNumber;
                fieldCount: import("zod").ZodOptional<import("zod").ZodNumber>;
                recordCount: import("zod").ZodOptional<import("zod").ZodNumber>;
                fileCount: import("zod").ZodOptional<import("zod").ZodNumber>;
              },
              import("zod/v4/core").$strip
            >
          >
        >;
        counts: import("zod").ZodObject<
          {
            folders: import("zod").ZodNumber;
            docs: import("zod").ZodNumber;
            bases: import("zod").ZodNumber;
            records: import("zod").ZodNumber;
            skills: import("zod").ZodNumber;
            airapps: import("zod").ZodNumber;
            drives: import("zod").ZodNumber;
            files: import("zod").ZodNumber;
          },
          import("zod/v4/core").$strip
        >;
        collisions: import("zod").ZodDefault<
          import("zod").ZodArray<
            import("zod").ZodObject<
              {
                kind: import("zod").ZodEnum<{
                  base: "base";
                  node: "node";
                }>;
                slug: import("zod").ZodString;
                path: import("zod").ZodString;
                renamedTo: import("zod").ZodOptional<import("zod").ZodString>;
              },
              import("zod/v4/core").$strip
            >
          >
        >;
        warnings: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
        requiresAutoMerge: import("zod").ZodBoolean;
        applicable: import("zod").ZodBoolean;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  fromGithub: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    import("zod").ZodObject<
      {
        repoUrl: import("zod").ZodString;
        intoFolder: import("zod").ZodOptional<import("zod").ZodString>;
        rename: import("zod").ZodOptional<import("zod").ZodBoolean>;
        autoMerge: import("zod").ZodOptional<import("zod").ZodBoolean>;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        targetFolderSlug: import("zod").ZodString;
        targetFolderNodeId: import("zod").ZodString;
        created: import("zod").ZodObject<
          {
            folders: import("zod").ZodNumber;
            docs: import("zod").ZodNumber;
            bases: import("zod").ZodNumber;
            views: import("zod").ZodNumber;
            records: import("zod").ZodNumber;
            fileTreeNodes: import("zod").ZodNumber;
            files: import("zod").ZodNumber;
          },
          import("zod/v4/core").$strip
        >;
        pendingChangeRequests: import("zod").ZodNumber;
        warnings: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
};
