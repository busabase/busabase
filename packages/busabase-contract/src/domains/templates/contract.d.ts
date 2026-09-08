/**
 * Template Center — the catalog a user browses before installing.
 *
 * Read-only and server-side on purpose. The catalog lives in a GitHub
 * repository, and a browser fetching it directly would hit CORS, would have no
 * cache shared between users, and would let the page decide which host to trust.
 * Installing is NOT here: a card's button hands its URL to the existing
 * `install.*` routes, so browsing and installing cannot disagree about what a
 * package is or who is allowed to install it.
 */
export declare const templatesContract: {
  list: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    import("zod").ZodDefault<
      import("zod").ZodOptional<
        import("zod").ZodObject<
          {
            refresh: import("zod").ZodOptional<import("zod").ZodBoolean>;
          },
          import("zod/v4/core").$strip
        >
      >
    >,
    import("zod").ZodObject<
      {
        templates: import("zod").ZodArray<
          import("zod").ZodObject<
            {
              id: import("zod").ZodString;
              name: import("zod").ZodString;
              description: import("zod").ZodString;
              category: import("zod").ZodString;
              tags: import("zod").ZodDefault<import("zod").ZodArray<import("zod").ZodString>>;
              screenshots: import("zod").ZodDefault<
                import("zod").ZodArray<import("zod").ZodString>
              >;
              agentPrompts: import("zod").ZodDefault<
                import("zod").ZodArray<import("zod").ZodString>
              >;
              version: import("zod").ZodOptional<import("zod").ZodString>;
              author: import("zod").ZodOptional<import("zod").ZodString>;
              license: import("zod").ZodOptional<import("zod").ZodString>;
              stats: import("zod").ZodObject<
                {
                  folders: import("zod").ZodNumber;
                  docs: import("zod").ZodNumber;
                  bases: import("zod").ZodNumber;
                  records: import("zod").ZodNumber;
                  files: import("zod").ZodNumber;
                  airapps: import("zod").ZodNumber;
                  skill: import("zod").ZodBoolean;
                },
                import("zod/v4/core").$strip
              >;
              install: import("zod").ZodObject<
                {
                  repoUrl: import("zod").ZodString;
                  intoFolder: import("zod").ZodString;
                },
                import("zod/v4/core").$strip
              >;
              sourceUrl: import("zod").ZodString;
            },
            import("zod/v4/core").$strip
          >
        >;
        repo: import("zod").ZodString;
        ref: import("zod").ZodString;
        error: import("zod").ZodOptional<import("zod").ZodString>;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
};
