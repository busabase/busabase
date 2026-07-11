import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { getContextSpaceId, resolveActorId } from "../../context";
import { getDb } from "../../db";
import { CURRENT_USER_ID } from "../../logic/kernel";
import { testFireRule } from "./logic/dispatch";
import {
  createWebhookRule,
  deleteWebhookRule,
  getWebhookRule,
  getWebhookRuleRow,
  listWebhookDeliveries,
  listWebhookRules,
  updateWebhookRule,
} from "./logic/webhook-logic";

const os = implement(busabaseContract);

export const webhookRouter = {
  list: os.webhooks.list.handler(async () => listWebhookRules(await getDb(), getContextSpaceId())),
  get: os.webhooks.get.handler(async ({ input }) => {
    const rule = await getWebhookRule(await getDb(), getContextSpaceId(), input.id);
    if (!rule) {
      throw new ORPCError("NOT_FOUND", { message: `Webhook rule not found: ${input.id}` });
    }
    return rule;
  }),
  create: os.webhooks.create.handler(async ({ input }) =>
    createWebhookRule(await getDb(), getContextSpaceId(), resolveActorId(CURRENT_USER_ID), input),
  ),
  update: os.webhooks.update.handler(async ({ input }) =>
    updateWebhookRule(
      await getDb(),
      getContextSpaceId(),
      resolveActorId(CURRENT_USER_ID),
      input.id,
      input,
    ),
  ),
  delete: os.webhooks.delete.handler(async ({ input }) =>
    deleteWebhookRule(await getDb(), getContextSpaceId(), input.id),
  ),
  deliveries: os.webhooks.deliveries.handler(async ({ input }) => {
    const db = await getDb();
    const spaceId = getContextSpaceId();
    // Confirm the rule belongs to the caller's space before returning its
    // delivery log — `listWebhookDeliveries` itself only takes `ruleId`.
    const rule = await getWebhookRule(db, spaceId, input.ruleId);
    if (!rule) {
      throw new ORPCError("NOT_FOUND", { message: `Webhook rule not found: ${input.ruleId}` });
    }
    return listWebhookDeliveries(db, input.ruleId, input.limit);
  }),
  testFire: os.webhooks.testFire.handler(async ({ input }) => {
    const db = await getDb();
    const spaceId = getContextSpaceId();
    // Needs the raw PO row (not the redacted VO) — `testFireRule` signs with
    // the rule's still-encrypted secret exactly like a real dispatch does.
    const rule = await getWebhookRuleRow(db, spaceId, input.id);
    if (!rule) {
      throw new ORPCError("NOT_FOUND", { message: `Webhook rule not found: ${input.id}` });
    }
    return testFireRule(db, rule);
  }),
};
