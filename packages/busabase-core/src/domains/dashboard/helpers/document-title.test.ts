import { describe, expect, it } from "vitest";
import { formatDashboardDocumentTitle, resolveDashboardDocumentTitle } from "./document-title";

describe("resolveDashboardDocumentTitle", () => {
  it("uses the Base node name instead of its view name", () => {
    expect(
      resolveDashboardDocumentTitle({
        baseName: "B表",
        fallbackTitle: "Grid view",
        isBaseRoute: true,
      }),
    ).toBe("B表");
  });

  it("uses the loaded node name for a node detail route", () => {
    expect(
      resolveDashboardDocumentTitle({
        fallbackTitle: "工作台",
        isBaseRoute: false,
        nodeName: "产品需求",
      }),
    ).toBe("产品需求");
  });
});

describe("formatDashboardDocumentTitle", () => {
  it("replaces the page portion while keeping the product suffix", () => {
    expect(formatDashboardDocumentTitle("项目计划", "工作台 | busabase")).toBe(
      "项目计划 | busabase",
    );
  });

  it("preserves the host's separator spacing", () => {
    expect(formatDashboardDocumentTitle("项目计划", "工作台|busabase")).toBe("项目计划|busabase");
  });

  it("uses the page title when the host has no title suffix", () => {
    expect(formatDashboardDocumentTitle("项目计划", "工作台")).toBe("项目计划");
  });
});
