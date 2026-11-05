import { describe, expect, it } from "vitest";
import { resolveWorkflowFunctionRule, type WorkflowFunctionRuleCandidate } from "./function-rule";

const fn = (
  patch: Partial<WorkflowFunctionRuleCandidate> &
    Pick<WorkflowFunctionRuleCandidate, "id" | "name">,
): WorkflowFunctionRuleCandidate => ({
  actionKind: "run_function",
  enabled: true,
  baseId: null,
  code: "return { score: 91 };",
  timeoutMs: 2000,
  ...patch,
});

describe("resolveWorkflowFunctionRule", () => {
  it("prefers the rule id over the function name", () => {
    const resolved = resolveWorkflowFunctionRule(
      [
        fn({ id: "wh_by_id", name: "other", code: "return { score: 1 };" }),
        fn({ id: "wh_by_name", name: "scoreLeadFit", code: "return { score: 2 };" }),
      ],
      { webhookRuleId: "wh_by_id", functionName: "scoreLeadFit", recordBaseId: null },
    );
    expect(resolved).toMatchObject({ ok: true, source: { ruleId: "wh_by_id", name: "other" } });
  });

  it("loads a single rule by function name", () => {
    const resolved = resolveWorkflowFunctionRule([fn({ id: "wh_score", name: "scoreLeadFit" })], {
      webhookRuleId: "",
      functionName: " scoreLeadFit ",
      recordBaseId: null,
    });
    expect(resolved).toMatchObject({
      ok: true,
      source: { ruleId: "wh_score", name: "scoreLeadFit", code: "return { score: 91 };" },
    });
  });

  it("fails cleanly when the step names nothing", () => {
    const resolved = resolveWorkflowFunctionRule([], {
      webhookRuleId: "  ",
      functionName: "",
      recordBaseId: null,
    });
    expect(resolved).toEqual({
      ok: false,
      message: "Function step has no webhook rule id or function name.",
    });
  });

  it("fails when the rule id is missing, disabled, or not a function", () => {
    expect(
      resolveWorkflowFunctionRule([], {
        webhookRuleId: "wh_missing",
        functionName: "scoreLeadFit",
        recordBaseId: null,
      }),
    ).toEqual({ ok: false, message: "Webhook function rule not found: wh_missing" });

    expect(
      resolveWorkflowFunctionRule([fn({ id: "wh_off", name: "scoreLeadFit", enabled: false })], {
        webhookRuleId: "wh_off",
        functionName: "",
        recordBaseId: null,
      }).ok,
    ).toBe(false);

    const http = resolveWorkflowFunctionRule(
      [
        fn({
          id: "wh_http",
          name: "enrich",
          actionKind: "webhook",
          code: null,
          timeoutMs: null,
        }),
      ],
      { webhookRuleId: "wh_http", functionName: "", recordBaseId: null },
    );
    expect(http).toEqual({
      ok: false,
      message: "Rule wh_http (enrich) is a webhook rule, not a function.",
    });
  });

  it("refuses an ambiguous name and a rule scoped to another base", () => {
    const ambiguous = resolveWorkflowFunctionRule(
      [fn({ id: "wh_a", name: "scoreLeadFit" }), fn({ id: "wh_b", name: "scoreLeadFit" })],
      { webhookRuleId: "", functionName: "scoreLeadFit", recordBaseId: null },
    );
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.message).toMatch(/Set the webhook rule id/);

    const otherBase = resolveWorkflowFunctionRule(
      [fn({ id: "wh_base", name: "scoreLeadFit", baseId: "bas_other" })],
      { webhookRuleId: "wh_base", functionName: "", recordBaseId: "bas_leads" },
    );
    expect(otherBase.ok).toBe(false);
    if (!otherBase.ok) expect(otherBase.message).toMatch(/bas_other/);
  });
});
