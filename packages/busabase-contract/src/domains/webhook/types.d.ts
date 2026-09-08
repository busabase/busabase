import { z } from "zod";
export declare const WebhookEventTypeSchema: z.ZodEnum<{
  ai_mention: "ai_mention";
  "asset.uploaded": "asset.uploaded";
  changes_requested: "changes_requested";
  "record.created": "record.created";
}>;
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;
export declare const WebhookActionKindSchema: z.ZodEnum<{
  notify_agent: "notify_agent";
  run_function: "run_function";
  webhook: "webhook";
}>;
export type WebhookActionKind = z.infer<typeof WebhookActionKindSchema>;
export declare const WebhookDeliveryStatusSchema: z.ZodEnum<{
  failed: "failed";
  skipped: "skipped";
  success: "success";
}>;
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusSchema>;
export declare const WebhookHttpConfigSchema: z.ZodObject<
  {
    targetUrl: z.ZodString;
    secret: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  },
  z.core.$strip
>;
export type WebhookHttpConfig = z.infer<typeof WebhookHttpConfigSchema>;
export declare const WebhookFunctionConfigSchema: z.ZodObject<
  {
    code: z.ZodString;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
  },
  z.core.$strip
>;
export type WebhookFunctionConfig = z.infer<typeof WebhookFunctionConfigSchema>;
export declare const WebhookHttpConfigVOSchema: z.ZodObject<
  {
    targetUrl: z.ZodString;
    hasSecret: z.ZodBoolean;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  },
  z.core.$strip
>;
export type WebhookHttpConfigVO = z.infer<typeof WebhookHttpConfigVOSchema>;
export declare const WebhookFunctionConfigVOSchema: z.ZodObject<
  {
    code: z.ZodString;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
  },
  z.core.$strip
>;
export type WebhookFunctionConfigVO = z.infer<typeof WebhookFunctionConfigVOSchema>;
export declare const WebhookRuleInputSchema: z.ZodDiscriminatedUnion<
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
>;
export type WebhookRuleInput = z.infer<typeof WebhookRuleInputSchema>;
export declare const WebhookRuleUpdateInputSchema: z.ZodDiscriminatedUnion<
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
>;
export type WebhookRuleUpdateInput = z.infer<typeof WebhookRuleUpdateInputSchema>;
export declare const WebhookRuleVOSchema: z.ZodDiscriminatedUnion<
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
>;
export type WebhookRuleVO = z.infer<typeof WebhookRuleVOSchema>;
export declare const WebhookDeliveryVOSchema: z.ZodObject<
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
>;
export type WebhookDeliveryVO = z.infer<typeof WebhookDeliveryVOSchema>;
export declare const ListWebhookRulesInputSchema: z.ZodDefault<
  z.ZodOptional<z.ZodObject<{}, z.core.$strip>>
>;
export type ListWebhookRulesInput = z.infer<typeof ListWebhookRulesInputSchema>;
export declare const ListWebhookDeliveriesInputSchema: z.ZodObject<
  {
    ruleId: z.ZodString;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
  },
  z.core.$strip
>;
export type ListWebhookDeliveriesInput = z.infer<typeof ListWebhookDeliveriesInputSchema>;
