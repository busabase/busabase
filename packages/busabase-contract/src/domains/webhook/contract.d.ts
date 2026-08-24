import { z } from "zod";
export declare const webhookContract: {
  list: import("@orpc/contract").ContractProcedureBuilderWithOutput<
    import("@orpc/contract").Schema<unknown, unknown>,
    z.ZodArray<
      z.ZodDiscriminatedUnion<
        [
          z.ZodObject<
            {
              id: z.ZodString;
              spaceId: z.ZodString;
              baseId: z.ZodNullable<z.ZodString>;
              name: z.ZodString;
              eventType: z.ZodEnum<{
                ai_mention: "ai_mention";
                "asset.uploaded": "asset.uploaded";
                changes_requested: "changes_requested";
                "record.created": "record.created";
              }>;
              enabled: z.ZodBoolean;
              createdBy: z.ZodString;
              createdAt: z.ZodString;
              updatedAt: z.ZodString;
              lastTriggeredAt: z.ZodNullable<z.ZodString>;
              lastStatus: z.ZodNullable<
                z.ZodEnum<{
                  failed: "failed";
                  skipped: "skipped";
                  success: "success";
                }>
              >;
              actionKind: z.ZodLiteral<"webhook">;
              config: z.ZodObject<
                {
                  targetUrl: z.ZodString;
                  hasSecret: z.ZodBoolean;
                  headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                },
                z.core.$strip
              >;
            },
            z.core.$strip
          >,
          z.ZodObject<
            {
              id: z.ZodString;
              spaceId: z.ZodString;
              baseId: z.ZodNullable<z.ZodString>;
              name: z.ZodString;
              eventType: z.ZodEnum<{
                ai_mention: "ai_mention";
                "asset.uploaded": "asset.uploaded";
                changes_requested: "changes_requested";
                "record.created": "record.created";
              }>;
              enabled: z.ZodBoolean;
              createdBy: z.ZodString;
              createdAt: z.ZodString;
              updatedAt: z.ZodString;
              lastTriggeredAt: z.ZodNullable<z.ZodString>;
              lastStatus: z.ZodNullable<
                z.ZodEnum<{
                  failed: "failed";
                  skipped: "skipped";
                  success: "success";
                }>
              >;
              actionKind: z.ZodLiteral<"notify_agent">;
              config: z.ZodObject<
                {
                  targetUrl: z.ZodString;
                  hasSecret: z.ZodBoolean;
                  headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                },
                z.core.$strip
              >;
            },
            z.core.$strip
          >,
          z.ZodObject<
            {
              id: z.ZodString;
              spaceId: z.ZodString;
              baseId: z.ZodNullable<z.ZodString>;
              name: z.ZodString;
              eventType: z.ZodEnum<{
                ai_mention: "ai_mention";
                "asset.uploaded": "asset.uploaded";
                changes_requested: "changes_requested";
                "record.created": "record.created";
              }>;
              enabled: z.ZodBoolean;
              createdBy: z.ZodString;
              createdAt: z.ZodString;
              updatedAt: z.ZodString;
              lastTriggeredAt: z.ZodNullable<z.ZodString>;
              lastStatus: z.ZodNullable<
                z.ZodEnum<{
                  failed: "failed";
                  skipped: "skipped";
                  success: "success";
                }>
              >;
              actionKind: z.ZodLiteral<"run_function">;
              config: z.ZodObject<
                {
                  code: z.ZodString;
                  timeoutMs: z.ZodDefault<z.ZodNumber>;
                },
                z.core.$strip
              >;
            },
            z.core.$strip
          >,
        ],
        "actionKind"
      >
    >,
    Record<never, never>,
    Record<never, never>
  >;
  get: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        id: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodDiscriminatedUnion<
      [
        z.ZodObject<
          {
            id: z.ZodString;
            spaceId: z.ZodString;
            baseId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            enabled: z.ZodBoolean;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            lastTriggeredAt: z.ZodNullable<z.ZodString>;
            lastStatus: z.ZodNullable<
              z.ZodEnum<{
                failed: "failed";
                skipped: "skipped";
                success: "success";
              }>
            >;
            actionKind: z.ZodLiteral<"webhook">;
            config: z.ZodObject<
              {
                targetUrl: z.ZodString;
                hasSecret: z.ZodBoolean;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            id: z.ZodString;
            spaceId: z.ZodString;
            baseId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            enabled: z.ZodBoolean;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            lastTriggeredAt: z.ZodNullable<z.ZodString>;
            lastStatus: z.ZodNullable<
              z.ZodEnum<{
                failed: "failed";
                skipped: "skipped";
                success: "success";
              }>
            >;
            actionKind: z.ZodLiteral<"notify_agent">;
            config: z.ZodObject<
              {
                targetUrl: z.ZodString;
                hasSecret: z.ZodBoolean;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            id: z.ZodString;
            spaceId: z.ZodString;
            baseId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            enabled: z.ZodBoolean;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            lastTriggeredAt: z.ZodNullable<z.ZodString>;
            lastStatus: z.ZodNullable<
              z.ZodEnum<{
                failed: "failed";
                skipped: "skipped";
                success: "success";
              }>
            >;
            actionKind: z.ZodLiteral<"run_function">;
            config: z.ZodObject<
              {
                code: z.ZodString;
                timeoutMs: z.ZodDefault<z.ZodNumber>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
      ],
      "actionKind"
    >,
    Record<never, never>,
    Record<never, never>
  >;
  create: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodDiscriminatedUnion<
      [
        z.ZodObject<
          {
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            baseId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            enabled: z.ZodDefault<z.ZodBoolean>;
            actionKind: z.ZodLiteral<"webhook">;
            config: z.ZodObject<
              {
                targetUrl: z.ZodString;
                secret: z.ZodOptional<z.ZodString>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            baseId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            enabled: z.ZodDefault<z.ZodBoolean>;
            actionKind: z.ZodLiteral<"notify_agent">;
            config: z.ZodObject<
              {
                targetUrl: z.ZodString;
                secret: z.ZodOptional<z.ZodString>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            baseId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            enabled: z.ZodDefault<z.ZodBoolean>;
            actionKind: z.ZodLiteral<"run_function">;
            config: z.ZodObject<
              {
                code: z.ZodString;
                timeoutMs: z.ZodDefault<z.ZodNumber>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
      ],
      "actionKind"
    >,
    z.ZodDiscriminatedUnion<
      [
        z.ZodObject<
          {
            id: z.ZodString;
            spaceId: z.ZodString;
            baseId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            enabled: z.ZodBoolean;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            lastTriggeredAt: z.ZodNullable<z.ZodString>;
            lastStatus: z.ZodNullable<
              z.ZodEnum<{
                failed: "failed";
                skipped: "skipped";
                success: "success";
              }>
            >;
            actionKind: z.ZodLiteral<"webhook">;
            config: z.ZodObject<
              {
                targetUrl: z.ZodString;
                hasSecret: z.ZodBoolean;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            id: z.ZodString;
            spaceId: z.ZodString;
            baseId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            enabled: z.ZodBoolean;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            lastTriggeredAt: z.ZodNullable<z.ZodString>;
            lastStatus: z.ZodNullable<
              z.ZodEnum<{
                failed: "failed";
                skipped: "skipped";
                success: "success";
              }>
            >;
            actionKind: z.ZodLiteral<"notify_agent">;
            config: z.ZodObject<
              {
                targetUrl: z.ZodString;
                hasSecret: z.ZodBoolean;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            id: z.ZodString;
            spaceId: z.ZodString;
            baseId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            enabled: z.ZodBoolean;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            lastTriggeredAt: z.ZodNullable<z.ZodString>;
            lastStatus: z.ZodNullable<
              z.ZodEnum<{
                failed: "failed";
                skipped: "skipped";
                success: "success";
              }>
            >;
            actionKind: z.ZodLiteral<"run_function">;
            config: z.ZodObject<
              {
                code: z.ZodString;
                timeoutMs: z.ZodDefault<z.ZodNumber>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
      ],
      "actionKind"
    >,
    Record<never, never>,
    Record<never, never>
  >;
  update: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodDiscriminatedUnion<
      [
        z.ZodObject<
          {
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            baseId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            enabled: z.ZodDefault<z.ZodBoolean>;
            id: z.ZodString;
            actionKind: z.ZodLiteral<"webhook">;
            config: z.ZodObject<
              {
                targetUrl: z.ZodString;
                secret: z.ZodOptional<z.ZodString>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            baseId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            enabled: z.ZodDefault<z.ZodBoolean>;
            id: z.ZodString;
            actionKind: z.ZodLiteral<"notify_agent">;
            config: z.ZodObject<
              {
                targetUrl: z.ZodString;
                secret: z.ZodOptional<z.ZodString>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            baseId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            enabled: z.ZodDefault<z.ZodBoolean>;
            id: z.ZodString;
            actionKind: z.ZodLiteral<"run_function">;
            config: z.ZodObject<
              {
                code: z.ZodString;
                timeoutMs: z.ZodDefault<z.ZodNumber>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
      ],
      "actionKind"
    >,
    z.ZodDiscriminatedUnion<
      [
        z.ZodObject<
          {
            id: z.ZodString;
            spaceId: z.ZodString;
            baseId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            enabled: z.ZodBoolean;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            lastTriggeredAt: z.ZodNullable<z.ZodString>;
            lastStatus: z.ZodNullable<
              z.ZodEnum<{
                failed: "failed";
                skipped: "skipped";
                success: "success";
              }>
            >;
            actionKind: z.ZodLiteral<"webhook">;
            config: z.ZodObject<
              {
                targetUrl: z.ZodString;
                hasSecret: z.ZodBoolean;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            id: z.ZodString;
            spaceId: z.ZodString;
            baseId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            enabled: z.ZodBoolean;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            lastTriggeredAt: z.ZodNullable<z.ZodString>;
            lastStatus: z.ZodNullable<
              z.ZodEnum<{
                failed: "failed";
                skipped: "skipped";
                success: "success";
              }>
            >;
            actionKind: z.ZodLiteral<"notify_agent">;
            config: z.ZodObject<
              {
                targetUrl: z.ZodString;
                hasSecret: z.ZodBoolean;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
        z.ZodObject<
          {
            id: z.ZodString;
            spaceId: z.ZodString;
            baseId: z.ZodNullable<z.ZodString>;
            name: z.ZodString;
            eventType: z.ZodEnum<{
              ai_mention: "ai_mention";
              "asset.uploaded": "asset.uploaded";
              changes_requested: "changes_requested";
              "record.created": "record.created";
            }>;
            enabled: z.ZodBoolean;
            createdBy: z.ZodString;
            createdAt: z.ZodString;
            updatedAt: z.ZodString;
            lastTriggeredAt: z.ZodNullable<z.ZodString>;
            lastStatus: z.ZodNullable<
              z.ZodEnum<{
                failed: "failed";
                skipped: "skipped";
                success: "success";
              }>
            >;
            actionKind: z.ZodLiteral<"run_function">;
            config: z.ZodObject<
              {
                code: z.ZodString;
                timeoutMs: z.ZodDefault<z.ZodNumber>;
              },
              z.core.$strip
            >;
          },
          z.core.$strip
        >,
      ],
      "actionKind"
    >,
    Record<never, never>,
    Record<never, never>
  >;
  delete: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        id: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        success: z.ZodBoolean;
      },
      z.core.$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
  deliveries: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        ruleId: z.ZodString;
        limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
      },
      z.core.$strip
    >,
    z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          ruleId: z.ZodString;
          eventType: z.ZodEnum<{
            ai_mention: "ai_mention";
            "asset.uploaded": "asset.uploaded";
            changes_requested: "changes_requested";
            "record.created": "record.created";
          }>;
          status: z.ZodEnum<{
            failed: "failed";
            skipped: "skipped";
            success: "success";
          }>;
          httpStatus: z.ZodNullable<z.ZodNumber>;
          detail: z.ZodNullable<z.ZodString>;
          durationMs: z.ZodNullable<z.ZodNumber>;
          createdAt: z.ZodString;
        },
        z.core.$strip
      >
    >,
    Record<never, never>,
    Record<never, never>
  >;
  testFire: import("@orpc/contract").ContractProcedureBuilderWithInputOutput<
    z.ZodObject<
      {
        id: z.ZodString;
      },
      z.core.$strip
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        ruleId: z.ZodString;
        eventType: z.ZodEnum<{
          ai_mention: "ai_mention";
          "asset.uploaded": "asset.uploaded";
          changes_requested: "changes_requested";
          "record.created": "record.created";
        }>;
        status: z.ZodEnum<{
          failed: "failed";
          skipped: "skipped";
          success: "success";
        }>;
        httpStatus: z.ZodNullable<z.ZodNumber>;
        detail: z.ZodNullable<z.ZodString>;
        durationMs: z.ZodNullable<z.ZodNumber>;
        createdAt: z.ZodString;
      },
      z.core.$strip
    >,
    Record<never, never>,
    Record<never, never>
  >;
};
