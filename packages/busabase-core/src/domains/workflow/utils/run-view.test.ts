import type { WorkflowRun } from "busabase-contract/domains/workflow/run";
import { describe, expect, it } from "vitest";
import {
  formatWorkflowRunJson,
  isWorkflowRunCancellable,
  mergeWorkflowRunPages,
  orderedWorkflowRunSteps,
  parseWorkflowRunLink,
  parseWorkflowRunPayload,
  upsertWorkflowRun,
  WORKFLOW_RUN_ACTIVE_POLL_MS,
  WORKFLOW_RUN_PAUSED_POLL_MS,
  workflowRunStatusLabelKey,
  workflowRunStepLabel,
  workflowRunStepStates,
  workflowRunsPollInterval,
  workflowStepReference,
} from "./run-view";

const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: "run-1",
  spaceId: "space-1",
  workflowNodeId: "workflow-1",
  status: "completed",
  trigger: "manual",
  startedBy: "user-1",
  startedVia: null,
  cancelledBy: null,
  cursorNodeId: null,
  previousNodeId: null,
  outputs: {},
  recordId: null,
  payload: {},
  pause: null,
  error: null,
  freshness: "snapshot-steps-plus-explicit-reread",
  startedAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T10:00:00.000Z",
  ...overrides,
});

const output = (capturedAt: string, kind = "action") => ({
  kind,
  capturedAt,
  record: null,
  data: {},
});

describe("workflowRunsPollInterval", () => {
  it("polls fast while any run is queued or running", () => {
    expect(workflowRunsPollInterval([{ status: "completed" }, { status: "queued" }])).toBe(
      WORKFLOW_RUN_ACTIVE_POLL_MS,
    );
    expect(workflowRunsPollInterval([{ status: "waiting" }, { status: "running" }])).toBe(
      WORKFLOW_RUN_ACTIVE_POLL_MS,
    );
  });

  it("polls slower while a run is paused on a Wait or an approval", () => {
    expect(workflowRunsPollInterval([{ status: "waiting" }])).toBe(WORKFLOW_RUN_PAUSED_POLL_MS);
    expect(workflowRunsPollInterval([{ status: "failed" }, { status: "waiting_approval" }])).toBe(
      WORKFLOW_RUN_PAUSED_POLL_MS,
    );
  });

  it("stops polling when every run has finished, or there are none", () => {
    expect(workflowRunsPollInterval([{ status: "completed" }, { status: "failed" }])).toBe(false);
    expect(workflowRunsPollInterval([])).toBe(false);
    expect(workflowRunsPollInterval(undefined)).toBe(false);
  });
});

describe("workflowRunStatusLabelKey", () => {
  it("maps every status to its catalog key", () => {
    expect(workflowRunStatusLabelKey("waiting_approval")).toBe("statusWaitingApproval");
    expect(workflowRunStatusLabelKey("queued")).toBe("statusQueued");
  });
});

describe("orderedWorkflowRunSteps", () => {
  it("orders steps by when they finished, not by object key order", () => {
    const steps = orderedWorkflowRunSteps({
      end: output("2026-10-30T10:00:03.000Z", "end"),
      trigger: output("2026-10-30T10:00:01.000Z", "trigger"),
      check: output("2026-10-30T10:00:02.000Z", "condition"),
    });
    expect(steps.map((step) => step.id)).toEqual(["trigger", "check", "end"]);
  });

  it("follows the execution sequence when two steps finish in the same millisecond", () => {
    // The real case: a webhook step and the condition right after it, read
    // back from Postgres jsonb, which sorts keys (here "fit" before "notify").
    const same = "2026-10-30T10:00:01.000Z";
    const steps = orderedWorkflowRunSteps({
      fit: { ...output(same, "condition"), sequence: 3 },
      notify: { ...output(same, "webhook"), sequence: 2 },
      score: { ...output("2026-10-30T10:00:00.500Z", "function"), sequence: 1 },
      trigger: { ...output("2026-10-30T10:00:00.000Z", "trigger"), sequence: 0 },
    });
    expect(steps.map((step) => step.id)).toEqual(["trigger", "score", "notify", "fit"]);
  });

  it("falls back to time, then key order, for runs stored without a sequence", () => {
    const same = "2026-10-30T10:00:01.000Z";
    const steps = orderedWorkflowRunSteps({ b: output(same), a: output(same) });
    expect(steps.map((step) => step.id)).toEqual(["b", "a"]);
  });
});

describe("workflowRunStepStates", () => {
  it("marks finished steps done and the paused step paused", () => {
    const states = workflowRunStepStates(
      run({
        status: "waiting",
        cursorNodeId: "wait",
        outputs: { trigger: output("2026-10-30T10:00:01.000Z") },
        pause: { kind: "wait", nodeId: "wait", resumeAt: "2026-10-30T11:00:00.000Z" },
      }),
    );
    expect(Object.fromEntries(states)).toEqual({ trigger: "done", wait: "paused" });
  });

  it("marks the step a failed run stopped at", () => {
    const states = workflowRunStepStates(
      run({
        status: "failed",
        cursorNodeId: "hook",
        outputs: { trigger: output("2026-10-30T10:00:01.000Z") },
        error: "boom",
      }),
    );
    expect(Object.fromEntries(states)).toEqual({ trigger: "done", hook: "failed" });
  });

  it("is empty without a run", () => {
    expect(workflowRunStepStates(null).size).toBe(0);
  });
});

describe("parseWorkflowRunPayload", () => {
  it("treats blank text as no payload", () => {
    expect(parseWorkflowRunPayload("  \n")).toEqual({ ok: true, payload: undefined });
  });

  it("accepts a JSON object", () => {
    expect(parseWorkflowRunPayload('{"score": 80}')).toEqual({ ok: true, payload: { score: 80 } });
  });

  it.each(["{score: 80}", "[1, 2]", "null", "42", '"text"'])("rejects %s", (text) => {
    expect(parseWorkflowRunPayload(text)).toEqual({ ok: false });
  });
});

describe("upsertWorkflowRun", () => {
  it("replaces an older copy and keeps the list newest first", () => {
    const older = run({ id: "old", startedAt: "2026-10-30T09:00:00.000Z" });
    const current = run({ id: "current", status: "waiting" });
    const updated = run({ id: "current", status: "completed" });
    const started = run({ id: "new", startedAt: "2026-10-30T11:00:00.000Z" });
    const list = upsertWorkflowRun(upsertWorkflowRun([current, older], updated), started);
    expect(list.map((entry) => [entry.id, entry.status])).toEqual([
      ["new", "completed"],
      ["current", "completed"],
      ["old", "completed"],
    ]);
  });
});

describe("workflowRunStepLabel", () => {
  it("uses the step's label, falling back to its id", () => {
    const steps = [{ id: "a", label: "Check score" }];
    expect(workflowRunStepLabel("a", steps)).toBe("Check score");
    expect(workflowRunStepLabel("gone", steps)).toBe("gone");
  });
});

describe("formatWorkflowRunJson", () => {
  it("pretty-prints values", () => {
    expect(formatWorkflowRunJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatWorkflowRunJson(undefined)).toBe("null");
  });
});

describe("cancelling and pages", () => {
  it("offers cancel only while a run is not finished and not mid-step", () => {
    expect(isWorkflowRunCancellable("queued")).toBe(true);
    expect(isWorkflowRunCancellable("waiting")).toBe(true);
    expect(isWorkflowRunCancellable("waiting_approval")).toBe(true);
    expect(isWorkflowRunCancellable("running")).toBe(false);
    expect(isWorkflowRunCancellable("completed")).toBe(false);
    expect(isWorkflowRunCancellable("cancelled")).toBe(false);
  });

  it("keeps the freshest copy of a run that sits in two pages", () => {
    const fresh = run({ id: "a", status: "completed" });
    const stale = run({ id: "a", status: "waiting" });
    expect(mergeWorkflowRunPages([fresh], [stale, run({ id: "b" })]).map((r) => r.status)).toEqual([
      "completed",
      "completed",
    ]);
  });
});

describe("parseWorkflowRunLink", () => {
  it("reads the links notifications send", () => {
    expect(parseWorkflowRunLink("#approval-wfr_1")).toEqual({ openRuns: true, runId: "wfr_1" });
    expect(parseWorkflowRunLink("#failed-wfr_2")).toEqual({ openRuns: true, runId: "wfr_2" });
    expect(parseWorkflowRunLink("#approval")).toEqual({ openRuns: true, runId: null });
    expect(parseWorkflowRunLink("#failed")).toEqual({ openRuns: true, runId: null });
  });

  it("ignores every other fragment", () => {
    expect(parseWorkflowRunLink("")).toEqual({ openRuns: false, runId: null });
    expect(parseWorkflowRunLink("#review-nod_1")).toEqual({ openRuns: false, runId: null });
    expect(parseWorkflowRunLink("#approvals")).toEqual({ openRuns: false, runId: null });
  });
});

describe("workflowStepReference", () => {
  it("uses a dot for a plain name and brackets for anything else", () => {
    expect(workflowStepReference("score")).toBe("steps.score");
    expect(workflowStepReference("step_2")).toBe("steps.step_2");
    expect(workflowStepReference("step-a1b2c3d4")).toBe('steps["step-a1b2c3d4"]');
    expect(workflowStepReference("2nd")).toBe('steps["2nd"]');
  });
});
