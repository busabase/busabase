import { describe, expect, it } from "vitest";
import { toolStatusLabel } from "./tool-status";

const t = {
  toolStatusPending: "Pending",
  toolStatusRunning: "Running",
  toolStatusCompleted: "Completed",
  toolStatusError: "Error",
};

describe("toolStatusLabel", () => {
  it("maps every ACP status to its own label", () => {
    expect(toolStatusLabel("pending", t)).toBe("Pending");
    expect(toolStatusLabel("in_progress", t)).toBe("Running");
    expect(toolStatusLabel("completed", t)).toBe("Completed");
    expect(toolStatusLabel("failed", t)).toBe("Error");
  });
});
