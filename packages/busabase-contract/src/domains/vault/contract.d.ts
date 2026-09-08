export declare const vaultContract: {
  get: import("@orpc/contract").ContractProcedureBuilderWithOutput<
    import("@orpc/contract").Schema<unknown, unknown>,
    import("zod").ZodObject<
      {
        ownerId: import("zod").ZodNullable<import("zod").ZodString>;
        items: import("zod").ZodArray<
          import("zod").ZodObject<
            {
              kind: import("zod").ZodEnum<{
                secret: "secret";
                variable: "variable";
              }>;
              key: import("zod").ZodString;
              value: import("zod").ZodString;
              scopeType: import("zod").ZodDefault<
                import("zod").ZodEnum<{
                  agent: "agent";
                  api_key: "api_key";
                  base: "base";
                  personal: "personal";
                  tool: "tool";
                  workspace: "workspace";
                }>
              >;
              environment: import("zod").ZodDefault<
                import("zod").ZodEnum<{
                  development: "development";
                  local: "local";
                  production: "production";
                  staging: "staging";
                }>
              >;
              description: import("zod").ZodDefault<import("zod").ZodString>;
              access: import("zod").ZodDefault<
                import("zod").ZodObject<
                  {
                    runtime: import("zod").ZodDefault<import("zod").ZodBoolean>;
                    reveal: import("zod").ZodDefault<import("zod").ZodBoolean>;
                    edit: import("zod").ZodDefault<import("zod").ZodBoolean>;
                    share: import("zod").ZodDefault<import("zod").ZodBoolean>;
                  },
                  import("zod/v4/core").$strip
                >
              >;
              id: import("zod").ZodString;
              scopeId: import("zod").ZodNullable<import("zod").ZodString>;
              updatedAt: import("zod").ZodString;
              createdAt: import("zod").ZodString;
              lastUsedAt: import("zod").ZodNullable<import("zod").ZodString>;
            },
            import("zod/v4/core").$strip
          >
        >;
        updatedAt: import("zod").ZodNullable<import("zod").ZodString>;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  update: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    import("zod").ZodObject<
      {
        items: import("zod").ZodArray<
          import("zod").ZodObject<
            {
              id: import("zod").ZodOptional<import("zod").ZodString>;
              kind: import("zod").ZodEnum<{
                secret: "secret";
                variable: "variable";
              }>;
              key: import("zod").ZodString;
              value: import("zod").ZodString;
              scopeType: import("zod").ZodDefault<
                import("zod").ZodEnum<{
                  agent: "agent";
                  api_key: "api_key";
                  base: "base";
                  personal: "personal";
                  tool: "tool";
                  workspace: "workspace";
                }>
              >;
              scopeId: import("zod").ZodOptional<
                import("zod").ZodNullable<import("zod").ZodString>
              >;
              environment: import("zod").ZodDefault<
                import("zod").ZodEnum<{
                  development: "development";
                  local: "local";
                  production: "production";
                  staging: "staging";
                }>
              >;
              description: import("zod").ZodDefault<import("zod").ZodString>;
              access: import("zod").ZodDefault<
                import("zod").ZodObject<
                  {
                    runtime: import("zod").ZodDefault<import("zod").ZodBoolean>;
                    reveal: import("zod").ZodDefault<import("zod").ZodBoolean>;
                    edit: import("zod").ZodDefault<import("zod").ZodBoolean>;
                    share: import("zod").ZodDefault<import("zod").ZodBoolean>;
                  },
                  import("zod/v4/core").$strip
                >
              >;
            },
            import("zod/v4/core").$strip
          >
        >;
      },
      import("zod/v4/core").$strip
    >,
    import("zod").ZodObject<
      {
        ownerId: import("zod").ZodNullable<import("zod").ZodString>;
        items: import("zod").ZodArray<
          import("zod").ZodObject<
            {
              kind: import("zod").ZodEnum<{
                secret: "secret";
                variable: "variable";
              }>;
              key: import("zod").ZodString;
              value: import("zod").ZodString;
              scopeType: import("zod").ZodDefault<
                import("zod").ZodEnum<{
                  agent: "agent";
                  api_key: "api_key";
                  base: "base";
                  personal: "personal";
                  tool: "tool";
                  workspace: "workspace";
                }>
              >;
              environment: import("zod").ZodDefault<
                import("zod").ZodEnum<{
                  development: "development";
                  local: "local";
                  production: "production";
                  staging: "staging";
                }>
              >;
              description: import("zod").ZodDefault<import("zod").ZodString>;
              access: import("zod").ZodDefault<
                import("zod").ZodObject<
                  {
                    runtime: import("zod").ZodDefault<import("zod").ZodBoolean>;
                    reveal: import("zod").ZodDefault<import("zod").ZodBoolean>;
                    edit: import("zod").ZodDefault<import("zod").ZodBoolean>;
                    share: import("zod").ZodDefault<import("zod").ZodBoolean>;
                  },
                  import("zod/v4/core").$strip
                >
              >;
              id: import("zod").ZodString;
              scopeId: import("zod").ZodNullable<import("zod").ZodString>;
              updatedAt: import("zod").ZodString;
              createdAt: import("zod").ZodString;
              lastUsedAt: import("zod").ZodNullable<import("zod").ZodString>;
            },
            import("zod/v4/core").$strip
          >
        >;
        updatedAt: import("zod").ZodNullable<import("zod").ZodString>;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  clear: import("@orpc/contract").ContractProcedureBuilderWithOutput<
    import("@orpc/contract").Schema<unknown, unknown>,
    import("zod").ZodObject<
      {
        success: import("zod").ZodBoolean;
      },
      import("zod/v4/core").$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
};
