import { describe, expect, it } from "vitest";
import type { AcpBlock, AcpToolCallBlock } from "../reduce";
import {
  getToolCategory,
  groupConsecutiveToolCalls,
  hasActiveToolCall,
  summarizeToolRun,
} from "./tool-runs";

const tool = (
  id: string,
  toolKind: AcpToolCallBlock["toolKind"] = "read",
  status: AcpToolCallBlock["status"] = "completed",
): AcpToolCallBlock => ({ kind: "tool_call", id, title: id, toolKind, status });

const message = (id: string): AcpBlock => ({
  kind: "message",
  id,
  role: "agent",
  variant: "message",
  text: id,
});

describe("getToolCategory", () => {
  // ACP hands us a real category, unlike the AI SDK's tool parts — this table
  // is the whole point of NOT reusing @kaiui/core's name-sniffing heuristic.
  it.each([
    ["read", "explore"],
    ["fetch", "explore"],
    ["search", "search"],
    ["edit", "edit"],
    ["delete", "edit"],
    ["move", "edit"],
    ["execute", "run"],
    ["think", "other"],
    ["switch_mode", "other"],
    ["other", "other"],
  ] as const)("%s → %s", (toolKind, category) => {
    expect(getToolCategory(toolKind)).toBe(category);
  });

  it("treats a missing toolKind (agent sent no `kind`) as other", () => {
    expect(getToolCategory(null)).toBe("other");
  });
});

describe("summarizeToolRun", () => {
  it("counts each category and the total", () => {
    const summary = summarizeToolRun([
      tool("t1", "read"),
      tool("t2", "fetch"),
      tool("t3", "execute"),
      tool("t4", "delete"),
    ]);
    expect(summary).toEqual({ explore: 2, search: 0, edit: 1, run: 1, other: 0, total: 4 });
  });

  it("returns all zeros for an empty run", () => {
    expect(summarizeToolRun([])).toEqual({
      explore: 0,
      search: 0,
      edit: 0,
      run: 0,
      other: 0,
      total: 0,
    });
  });
});

describe("hasActiveToolCall", () => {
  it("is true while any tool is pending or in_progress", () => {
    expect(
      hasActiveToolCall([tool("t1", "read", "completed"), tool("t2", "read", "pending")]),
    ).toBe(true);
    expect(
      hasActiveToolCall([tool("t1", "read", "completed"), tool("t2", "read", "in_progress")]),
    ).toBe(true);
  });

  it("is false once every tool has settled", () => {
    expect(hasActiveToolCall([tool("t1", "read", "completed"), tool("t2", "read", "failed")])).toBe(
      false,
    );
  });

  it("is false for an empty run", () => {
    expect(hasActiveToolCall([])).toBe(false);
  });
});

describe("groupConsecutiveToolCalls", () => {
  it("collapses two-or-more consecutive tool calls into one run", () => {
    const groups = groupConsecutiveToolCalls([tool("t1"), tool("t2"), tool("t3")]);
    expect(groups).toEqual([{ kind: "run", blocks: [tool("t1"), tool("t2"), tool("t3")] }]);
  });

  // Matches what buda renders today: a lone tool call shows as itself, not as
  // a one-item group with an extra collapse affordance around it.
  it("emits a single tool call as `single`, not a one-item run", () => {
    const groups = groupConsecutiveToolCalls([tool("t1")]);
    expect(groups).toEqual([{ kind: "single", block: tool("t1") }]);
  });

  it("does not merge tool calls separated by a message", () => {
    const groups = groupConsecutiveToolCalls([tool("t1"), tool("t2"), message("m1"), tool("t3")]);
    expect(groups).toEqual([
      { kind: "run", blocks: [tool("t1"), tool("t2")] },
      { kind: "single", block: message("m1") },
      { kind: "single", block: tool("t3") },
    ]);
  });

  it("passes non-tool-call blocks through untouched, in order", () => {
    const groups = groupConsecutiveToolCalls([message("m1"), message("m2")]);
    expect(groups).toEqual([
      { kind: "single", block: message("m1") },
      { kind: "single", block: message("m2") },
    ]);
  });

  it("handles an empty list", () => {
    expect(groupConsecutiveToolCalls([])).toEqual([]);
  });

  it("flushes a trailing run at the end of the list", () => {
    const groups = groupConsecutiveToolCalls([message("m1"), tool("t1"), tool("t2")]);
    expect(groups).toEqual([
      { kind: "single", block: message("m1") },
      { kind: "run", blocks: [tool("t1"), tool("t2")] },
    ]);
  });
});
