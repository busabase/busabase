import { describe, expect, it } from "vitest";
import { evaluateCondition, evaluateValue } from "./expression";

const scope = {
  input: { score: 80, record: { fields: { status: "new" } } },
  steps: {
    capture: { record: { fields: { status: "new" } } },
    reload: { record: { fields: { status: "edited" } } },
  },
};

describe("workflow conditions", () => {
  it("evaluates the demo lead-score comparison", () => {
    expect(evaluateCondition("input.score >= 80", scope)).toBe(true);
    expect(evaluateCondition("input.score >= 80", { ...scope, input: { score: 79 } })).toBe(false);
  });

  it("reads a frozen step and a later reload as different values", () => {
    expect(evaluateCondition('steps.capture.record.fields.status == "new"', scope)).toBe(true);
    expect(evaluateCondition('steps.reload.record.fields.status == "edited"', scope)).toBe(true);
    expect(evaluateCondition('input.record.fields.status == "new"', scope)).toBe(true);
  });

  it("does not coerce text to a number", () => {
    expect(() => evaluateCondition('input.score >= "80"', scope)).toThrow(/Cannot compare/);
  });

  it("rejects names outside input and steps", () => {
    expect(() => evaluateCondition("record.status == true", scope)).toThrow(/Unknown name/);
    // Prototype keys read as missing, never as Object.prototype members.
    expect(evaluateCondition("steps.constructor != null", scope)).toBe(false);
    expect(evaluateCondition('input["__proto__"] != null', scope)).toBe(false);
  });

  it("short-circuits so a guard protects the comparison after it", () => {
    const missing = { ...scope, input: {} };
    expect(evaluateCondition("input.score != null && input.score >= 80", missing)).toBe(false);
    expect(evaluateCondition("input.score == null || input.score >= 80", missing)).toBe(true);
    // Without the guard the same comparison still refuses to guess.
    expect(() => evaluateCondition("input.score >= 80", missing)).toThrow(/missing >= number/);
  });

  it("treats a missing value as null and nothing else", () => {
    expect(evaluateCondition("input.nothing == null", scope)).toBe(true);
    expect(evaluateCondition("input.score == null", scope)).toBe(false);
    expect(evaluateCondition('input.nothing == ""', scope)).toBe(false);
  });

  it("reads keys a dot cannot reach with brackets", () => {
    const fields = {
      ...scope,
      input: { fields: { "follow-up": "call", 状态: "新" }, items: [{ ok: true }] },
    };
    expect(evaluateCondition('input.fields["follow-up"] == "call"', fields)).toBe(true);
    expect(evaluateCondition("input.fields['状态'] == '新'", fields)).toBe(true);
    expect(evaluateCondition("input.items[0].ok", fields)).toBe(true);
    expect(evaluateCondition("input.items[3] == null", fields)).toBe(true);
    expect(() => evaluateCondition("input.fields[follow]", fields)).toThrow(/quoted key/);
  });

  it("keeps != apart from negation", () => {
    expect(evaluateCondition("!(input.score != 80)", scope)).toBe(true);
    expect(evaluateCondition("!false && true", scope)).toBe(true);
  });
});

describe("evaluateValue", () => {
  const scope = {
    input: { status: 200, body: { name: "Ada" } },
    steps: { score: { score: 91, list: [1, 2] } },
  };

  it("returns the value of any type, not just a yes or no", () => {
    expect(evaluateValue("steps.score.score", scope)).toBe(91);
    expect(evaluateValue("input.body.name", scope)).toBe("Ada");
    expect(evaluateValue("steps.score.list[1]", scope)).toBe(2);
    expect(evaluateValue("steps.score.score >= 80", scope)).toBe(true);
  });

  it("returns undefined for a path that leads nowhere", () => {
    expect(evaluateValue("steps.score.missing", scope)).toBeUndefined();
    expect(evaluateValue("steps.nobody.score", scope)).toBeUndefined();
  });

  it("still refuses what a condition refuses", () => {
    expect(() => evaluateValue("steps.score.constructor", scope)).not.toThrow();
    expect(evaluateValue("steps.score.constructor", scope)).toBeUndefined();
    expect(() => evaluateValue("process.exit()", scope)).toThrow();
  });
});

describe("a step id with a dash", () => {
  const scope = { input: {}, steps: { "on-update": { status: "new" } } };

  it("is read with brackets", () => {
    expect(evaluateValue('steps["on-update"].status', scope)).toBe("new");
  });

  it("says how to write it when a dot is used", () => {
    expect(() => evaluateValue("steps.on-update.status", scope)).toThrow(
      'A name with a dash needs brackets: write ["on-update"] instead of .on-update',
    );
  });
});
