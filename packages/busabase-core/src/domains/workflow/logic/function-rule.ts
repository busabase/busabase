/**
 * Which saved webhook rule a workflow function step runs.
 *
 * A function step does not carry source code. It points at a webhook rule
 * whose action is `run_function` — by rule id, or by a function name that
 * matches exactly one such rule in the space. The body itself is executed by
 * the webhook sandbox (`runFunction`), not by a second interpreter.
 *
 * HTTP webhook rules are rejected here. Workflow webhook steps still do not
 * deliver HTTP.
 */

export interface WorkflowFunctionRuleCandidate {
  id: string;
  name: string;
  actionKind: string;
  enabled: boolean;
  baseId: string | null;
  code: string | null;
  timeoutMs: number | null;
}

export interface WorkflowFunctionLookup {
  webhookRuleId: string;
  functionName: string;
  /** Bound record's base, when the run has one. Null when the run has no record. */
  recordBaseId: string | null;
}

export interface WorkflowFunctionSource {
  ruleId: string;
  name: string;
  code: string;
  timeoutMs: number;
}

export type WorkflowFunctionResolution =
  | { ok: true; source: WorkflowFunctionSource }
  | { ok: false; message: string };

const wrongKind = (rule: WorkflowFunctionRuleCandidate): WorkflowFunctionResolution => ({
  ok: false,
  message: `Rule ${rule.id} (${rule.name}) is a ${rule.actionKind} rule, not a function.`,
});

const baseMismatch = (rule: WorkflowFunctionRuleCandidate): WorkflowFunctionResolution => ({
  ok: false,
  message:
    `Function rule ${rule.id} (${rule.name}) belongs to base ${rule.baseId ?? "unknown"}, ` +
    "not this record's base.",
});

const accept = (
  rule: WorkflowFunctionRuleCandidate,
  recordBaseId: string | null,
): WorkflowFunctionResolution => {
  if (rule.actionKind !== "run_function") return wrongKind(rule);
  if (recordBaseId && rule.baseId && rule.baseId !== recordBaseId) return baseMismatch(rule);
  if (!rule.enabled) {
    return { ok: false, message: `Function rule ${rule.id} (${rule.name}) is disabled.` };
  }
  if (!rule.code || rule.code.trim().length === 0) {
    return { ok: false, message: `Function rule ${rule.id} (${rule.name}) has no code.` };
  }
  if (
    typeof rule.timeoutMs !== "number" ||
    !Number.isInteger(rule.timeoutMs) ||
    rule.timeoutMs < 1
  ) {
    return {
      ok: false,
      message: `Function rule ${rule.id} (${rule.name}) has an invalid timeout.`,
    };
  }
  return {
    ok: true,
    source: {
      ruleId: rule.id,
      name: rule.name,
      code: rule.code,
      timeoutMs: rule.timeoutMs,
    },
  };
};

export const resolveWorkflowFunctionRule = (
  rules: readonly WorkflowFunctionRuleCandidate[],
  lookup: WorkflowFunctionLookup,
): WorkflowFunctionResolution => {
  const ruleId = lookup.webhookRuleId.trim();
  const functionName = lookup.functionName.trim();
  if (!ruleId && !functionName) {
    return { ok: false, message: "Function step has no webhook rule id or function name." };
  }

  if (ruleId) {
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) return { ok: false, message: `Webhook function rule not found: ${ruleId}` };
    return accept(rule, lookup.recordBaseId);
  }

  const named = rules.filter((item) => item.name === functionName);
  if (named.length === 0) {
    return { ok: false, message: `No run_function rule named "${functionName}" in this space.` };
  }
  const functions = named.filter((item) => item.actionKind === "run_function");
  if (functions.length === 0) {
    const only = named.length === 1 ? named[0] : undefined;
    if (only) return wrongKind(only);
    return {
      ok: false,
      message: `Rules named "${functionName}" are not functions. Set the webhook rule id.`,
    };
  }

  let candidates = functions;
  if (lookup.recordBaseId) {
    const inScope = functions.filter(
      (item) => item.baseId == null || item.baseId === lookup.recordBaseId,
    );
    if (inScope.length === 0) {
      return {
        ok: false,
        message: `Function rules named "${functionName}" belong to another base, not this record's base.`,
      };
    }
    candidates = inScope;
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      message: `More than one run_function rule is named "${functionName}". Set the webhook rule id.`,
    };
  }
  const rule = candidates[0];
  if (!rule) {
    return { ok: false, message: `No run_function rule named "${functionName}" in this space.` };
  }
  return accept(rule, lookup.recordBaseId);
};
