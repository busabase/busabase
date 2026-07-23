import {
  parseHtmlDocument,
  parseWhiteboardDocument,
  parseWorkflowDocument,
} from "busabase-contract/domains/rich-node/types";
import { describe, expect, it } from "vitest";
import { buildDemoDataset, englishScenario } from "../src/demo/dataset";
import { zhCnScenario } from "../src/demo/scenarios/zh-cn";

const expectedTypes = ["whiteboard", "workflow", "html"] as const;

const flattenNodes = (nodes: ReturnType<typeof buildDemoDataset>["nodes"]) =>
  nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);

describe.each([
  ["English", englishScenario],
  ["Simplified Chinese", zhCnScenario],
])("%s rich-node demo seed", (_locale, scenario) => {
  it("includes populated metadata for every rich node in the stateless demo", () => {
    const nodes = flattenNodes(
      buildDemoDataset("1", new Date("2026-07-22T00:00:00Z"), scenario).nodes,
    );
    const richNodes = nodes.filter((node) =>
      expectedTypes.includes(node.type as (typeof expectedTypes)[number]),
    );

    expect(richNodes.map((node) => node.type).sort()).toEqual([...expectedTypes].sort());
    expect(
      parseWhiteboardDocument(
        richNodes.find((node) => node.type === "whiteboard")?.metadata.whiteboardDocument,
      ).elements.length,
    ).toBeGreaterThan(0);
    expect(
      parseWorkflowDocument(
        richNodes.find((node) => node.type === "workflow")?.metadata.workflowDocument,
      ).nodes.map((workflowNode) => workflowNode.kind),
    ).toEqual(
      expect.arrayContaining([
        "trigger",
        "webhook",
        "function",
        "condition",
        "wait",
        "approval",
        "action",
        "end",
      ]),
    );
    expect(
      parseHtmlDocument(richNodes.find((node) => node.type === "html")?.metadata.htmlDocument)
        .source,
    ).toContain("<form");
  });
});
