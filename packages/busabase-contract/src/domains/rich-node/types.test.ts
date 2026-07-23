import { describe, expect, it } from "vitest";
import { CREATABLE_NODE_TYPES, getNodeType } from "../registry";
import {
  DEFAULT_HTML_DOCUMENT,
  parseHtmlDocument,
  parseWhiteboardDocument,
  parseWorkflowDocument,
} from "./types";

describe("rich node types", () => {
  it("registers every rich node as creatable with a detail route", () => {
    for (const type of ["whiteboard", "workflow", "html"] as const) {
      expect(CREATABLE_NODE_TYPES).toContain(type);
      expect(getNodeType(type)?.capabilities).toMatchObject({ creatable: true, hasDetail: true });
    }
  });

  it("falls back to safe documents when metadata is malformed", () => {
    expect(parseWhiteboardDocument({ version: 9 }).elements).toEqual([]);
    expect(parseWorkflowDocument({ nodes: "not-an-array" }).nodes[0]?.kind).toBe("trigger");
    expect(parseHtmlDocument({ version: 2, source: "bad-version" })).toEqual(DEFAULT_HTML_DOCUMENT);
  });

  it("drops graph edges whose source or target no longer exists", () => {
    const workflow = parseWorkflowDocument({
      version: 2,
      nodes: [
        {
          id: "trigger",
          kind: "trigger",
          position: { x: 0, y: 0 },
          label: "Trigger",
        },
        {
          id: "hook",
          kind: "webhook",
          position: { x: 200, y: 0 },
          label: "Webhook",
          url: "https://example.com/hook",
        },
      ],
      edges: [
        { id: "valid", source: "trigger", target: "hook", label: "next", outcome: "success" },
        { id: "dangling", source: "hook", target: "deleted" },
      ],
      settings: {},
    });

    expect(workflow.edges).toEqual([
      { id: "valid", source: "trigger", target: "hook", label: "next", outcome: "success" },
    ]);
  });

  it("keeps execution-ready workflow node configurations separate by kind", () => {
    const workflow = parseWorkflowDocument({
      version: 2,
      nodes: [
        {
          id: "function",
          kind: "function",
          position: { x: 0, y: 0 },
          label: "Score lead",
          webhookRuleId: "whr_score_lead",
          functionName: "scoreLead",
        },
        {
          id: "wait",
          kind: "wait",
          position: { x: 200, y: 0 },
          label: "Wait",
          duration: 30,
          unit: "minutes",
        },
      ],
      edges: [],
      settings: { executionMode: "event", concurrency: 4 },
    });

    expect(workflow.nodes[0]).toMatchObject({
      kind: "function",
      webhookRuleId: "whr_score_lead",
    });
    expect(workflow.settings).toMatchObject({ executionMode: "event", concurrency: 4 });
  });
});
