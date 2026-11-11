import type { WorkflowRun } from "busabase-contract/domains/workflow/run";
import { describe, expect, it } from "vitest";
import { canDecideRun, clipStepJson, workflowRunStarterName, workflowRunTone } from "./run-display";

const run = (over: Partial<WorkflowRun>): Pick<WorkflowRun, "id" | "status" | "pause"> => ({
  id: "run_1",
  status: "waiting_approval",
  pause: { kind: "approval", nodeId: "review", resumeAt: null },
  ...over,
});

describe("workflowRunTone", () => {
  it("separates work in progress, waiting on someone, done, failed and stopped", () => {
    expect(workflowRunTone("queued")).toBe("active");
    expect(workflowRunTone("running")).toBe("active");
    expect(workflowRunTone("waiting")).toBe("attention");
    expect(workflowRunTone("waiting_approval")).toBe("attention");
    expect(workflowRunTone("completed")).toBe("success");
    expect(workflowRunTone("failed")).toBe("failure");
    expect(workflowRunTone("cancelled")).toBe("muted");
  });
});

describe("workflowRunStarterName", () => {
  it("shows the person's name, or the id when the server named nobody", () => {
    expect(workflowRunStarterName({ startedBy: "usr_a" }, { usr_a: "Ada" })).toBe("Ada");
    expect(workflowRunStarterName({ startedBy: "usr_b" }, { usr_a: "Ada" })).toBe("usr_b");
  });
});

describe("clipStepJson", () => {
  it("pretty-prints a short value whole", () => {
    expect(clipStepJson({ status: 200 })).toBe('{\n  "status": 200\n}');
  });

  it("cuts a long response and marks the cut", () => {
    const text = clipStepJson({ body: "x".repeat(5000) }, 200);
    expect(text.length).toBeLessThan(220);
    expect(text.endsWith("\n…")).toBe(true);
  });

  it("does not throw on a value JSON cannot hold", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => clipStepJson(loop)).not.toThrow();
  });
});

describe("canDecideRun", () => {
  it("offers the decision only on an approval pause the caller was allowed to decide", () => {
    expect(canDecideRun(run({}), ["run_1"])).toBe(true);
    // Allowed on another run, not this one.
    expect(canDecideRun(run({}), ["run_2"])).toBe(false);
    // Already decided: the run moved on, so a stale allow-list must not offer it again.
    expect(canDecideRun(run({ status: "completed", pause: null }), ["run_1"])).toBe(false);
    // A Wait is not an approval.
    expect(
      canDecideRun(
        run({ status: "waiting", pause: { kind: "wait", nodeId: "w", resumeAt: null } }),
        ["run_1"],
      ),
    ).toBe(false);
  });

  it("checks the run's own status and pause, not only the allow-list", () => {
    // Each guard on its own: a finished run that still carries an approval pause…
    expect(canDecideRun(run({ status: "completed" }), ["run_1"])).toBe(false);
    // …and a run marked as waiting for approval whose pause is not an approval.
    expect(canDecideRun(run({ pause: null }), ["run_1"])).toBe(false);
    expect(
      canDecideRun(run({ pause: { kind: "wait", nodeId: "w", resumeAt: null } }), ["run_1"]),
    ).toBe(false);
  });
});
