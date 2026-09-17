import { describe, expect, it } from "vitest";
import { getGraphAriaLabels } from "../src/i18n/graph-aria";
import { dashboardJa } from "../src/i18n/ja";
import { coreMessagesEn } from "../src/i18n/messages";
import { dashboardZhCN } from "../src/i18n/zh-CN";
import { dashboardZhTW } from "../src/i18n/zh-TW";

describe("getGraphAriaLabels", () => {
  it("uses the active language for graph controls and keyboard guidance", () => {
    for (const messages of [coreMessagesEn, dashboardZhCN, dashboardZhTW, dashboardJa]) {
      const labels = getGraphAriaLabels(messages);
      expect(labels["controls.ariaLabel"]).toBe(messages.richNodes.controlPanel);
      expect(labels["controls.zoomIn.ariaLabel"]).toBe(messages.richNodes.zoomIn);
      expect(labels["controls.zoomOut.ariaLabel"]).toBe(messages.richNodes.zoomOut);
      expect(labels["controls.fitView.ariaLabel"]).toBe(messages.richNodes.fitView);
      expect(labels["node.a11yDescription.default"]).toBe(messages.graph.nodeInstructions);
      expect(labels["edge.a11yDescription.default"]).toBe(messages.graph.edgeInstructions);
      for (const direction of ["up", "down", "left", "right"] as const) {
        expect(labels["node.a11yDescription.ariaLiveMessage"]?.({ direction, x: 10, y: 20 })).toBe(
          messages.graph.nodeMoved
            .replace("{direction}", messages.graph.directions[direction])
            .replace("{x}", "10")
            .replace("{y}", "20"),
        );
      }
    }
  });
});
