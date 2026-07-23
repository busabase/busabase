import { parseWorkflowDocument } from "busabase-contract/domains/rich-node/types";
import { LOCAL_SPACE_ID } from "busabase-core/context";
import { getDb } from "busabase-core/db";
import { busabaseNodes } from "busabase-core/db/schema";
import { DEMO_ACTOR_ID } from "busabase-core/demo/dataset";
import { createWebhookRule, listWebhookRules } from "busabase-core/domains/webhook/logic";
import { eq } from "drizzle-orm";

const WORKFLOW_NODE_ID = "nod_workflow_lead_intake";

type WebhookRuleSeed = Parameters<typeof createWebhookRule>[3];

interface DemoWebhookRulesInput {
  rules: WebhookRuleSeed[];
  workflowFunctionRuleName: string;
}

export const seedDemoWebhookRules = async ({
  rules,
  workflowFunctionRuleName,
}: DemoWebhookRulesInput): Promise<void> => {
  const db = await getDb();
  const existingRules = await listWebhookRules(db, LOCAL_SPACE_ID);
  const resolvedRules = [];

  for (const rule of rules) {
    const existing = existingRules.find(
      (candidate) => candidate.name === rule.name && candidate.actionKind === rule.actionKind,
    );
    resolvedRules.push(
      existing ?? (await createWebhookRule(db, LOCAL_SPACE_ID, DEMO_ACTOR_ID, rule)),
    );
  }

  const functionRule = resolvedRules.find(
    (rule) => rule.name === workflowFunctionRuleName && rule.actionKind === "run_function",
  );
  if (!functionRule)
    throw new Error(`Workflow function rule not found: ${workflowFunctionRuleName}`);

  const [workflowNode] = await db
    .select({ metadata: busabaseNodes.metadata })
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, WORKFLOW_NODE_ID))
    .limit(1);
  if (!workflowNode) return;

  const workflowDocument = parseWorkflowDocument(workflowNode.metadata.workflowDocument);
  await db
    .update(busabaseNodes)
    .set({
      metadata: {
        ...workflowNode.metadata,
        workflowDocument: {
          ...workflowDocument,
          nodes: workflowDocument.nodes.map((node) =>
            node.kind === "function" ? { ...node, webhookRuleId: functionRule.id } : node,
          ),
        },
      },
    })
    .where(eq(busabaseNodes.id, WORKFLOW_NODE_ID));
};
