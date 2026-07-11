import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  ListWebhookDeliveriesInputSchema,
  WebhookDeliveryVOSchema,
  WebhookRuleInputSchema,
  WebhookRuleUpdateInputSchema,
  WebhookRuleVOSchema,
} from "./types";

export const webhookContract = {
  list: oc
    .route({
      method: "GET",
      path: "/webhooks",
      tags: ["Webhooks"],
      summary: "List webhook automation rules",
      successDescription: "Configured webhook automation rules for this space.",
    })
    .output(WebhookRuleVOSchema.array()),
  get: oc
    .route({
      method: "GET",
      path: "/webhooks/{id}",
      tags: ["Webhooks"],
      summary: "Get webhook automation rule",
      successDescription: "A single webhook automation rule.",
    })
    .input(z.object({ id: z.string() }))
    .output(WebhookRuleVOSchema),
  create: oc
    .route({
      method: "POST",
      path: "/webhooks",
      tags: ["Webhooks"],
      summary: "Create webhook automation rule",
      successDescription:
        "Created webhook automation rule. Dispatches on the configured event via an HTTP webhook, an agent notification, or a sandboxed snippet.",
    })
    .input(WebhookRuleInputSchema)
    .output(WebhookRuleVOSchema),
  update: oc
    .route({
      method: "PUT",
      path: "/webhooks/{id}",
      tags: ["Webhooks"],
      summary: "Update webhook automation rule",
      successDescription: "Updated webhook automation rule.",
    })
    .input(WebhookRuleUpdateInputSchema)
    .output(WebhookRuleVOSchema),
  delete: oc
    .route({
      method: "DELETE",
      path: "/webhooks/{id}",
      tags: ["Webhooks"],
      summary: "Delete webhook automation rule",
      successDescription: "Removed the webhook automation rule.",
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),
  deliveries: oc
    .route({
      method: "GET",
      path: "/webhooks/{ruleId}/deliveries",
      tags: ["Webhooks"],
      summary: "List webhook rule delivery attempts",
      successDescription: "Recent delivery attempts for a webhook rule, newest first.",
    })
    .input(ListWebhookDeliveriesInputSchema)
    .output(WebhookDeliveryVOSchema.array()),
  testFire: oc
    .route({
      method: "POST",
      path: "/webhooks/{id}/test-fire",
      tags: ["Webhooks"],
      summary: "Test-fire a webhook automation rule",
      successDescription:
        "The delivery record produced by firing this rule right now with a synthetic payload — runs regardless of the rule's enabled state or its real trigger.",
    })
    .input(z.object({ id: z.string() }))
    .output(WebhookDeliveryVOSchema),
};
