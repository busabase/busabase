import { describe, expect, it } from "vitest";
import { kuiToolState } from "./tool-status";

describe("ACP tool status → kui tool state", () => {
  // Pinned because the mapping is the one place ACP's vocabulary meets the
  // AI-SDK-shaped vocabulary kui's <ToolHeader> speaks. The labels kui derives
  // from these states are what the user actually reads.
  it.each([
    ["pending", "input-streaming", "Pending"],
    ["in_progress", "input-available", "Running"],
    ["completed", "output-available", "Completed"],
    ["failed", "output-error", "Error"],
  ] as const)("%s → %s (renders as %s)", (status, state, _label) => {
    expect(kuiToolState(status)).toBe(state);
  });

  it("maps every ACP status to a distinct state", () => {
    const states = (["pending", "in_progress", "completed", "failed"] as const).map(kuiToolState);
    expect(new Set(states).size).toBe(4);
  });
});
