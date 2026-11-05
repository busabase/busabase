import "server-only";

import type { BusabaseDatabase } from "../../../context";
import { listWebhookRules } from "../../webhook/logic/webhook-logic";
import type { WebhookRuleVO } from "../../webhook/types/webhook";
import {
  resolveWorkflowFunctionRule,
  type WorkflowFunctionLookup,
  type WorkflowFunctionResolution,
  type WorkflowFunctionRuleCandidate,
} from "./function-rule";

const toCandidate = (rule: WebhookRuleVO): WorkflowFunctionRuleCandidate => ({
  id: rule.id,
  name: rule.name,
  actionKind: rule.actionKind,
  enabled: rule.enabled,
  baseId: rule.baseId,
  code: rule.actionKind === "run_function" ? rule.config.code : null,
  timeoutMs: rule.actionKind === "run_function" ? rule.config.timeoutMs : null,
});

/**
 * Load the `run_function` rule a workflow step names. Does not record a
 * webhook delivery — a workflow step is not a webhook event.
 */
export const loadWorkflowFunctionSource = async (
  db: BusabaseDatabase,
  spaceId: string,
  lookup: WorkflowFunctionLookup,
): Promise<WorkflowFunctionResolution> => {
  const rules = await listWebhookRules(db, spaceId);
  return resolveWorkflowFunctionRule(rules.map(toCandidate), lookup);
};
