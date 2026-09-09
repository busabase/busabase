import type { InstallPlanVO } from "busabase-contract/domains/install/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider, useCoreI18n } from "../../../i18n";
import { PackageSummary } from "./install-from-github-modal";

Object.assign(globalThis, { React });

const plan: InstallPlanVO = {
  package: {
    name: "Customer Support",
    description: "A ready-to-use customer support workspace",
    version: "1.2.0",
    author: "Busabase",
    license: "MIT",
    tags: [],
  },
  source: {
    owner: "busabase",
    repo: "templates",
    subdir: "templates/customer-support",
  },
  targetFolderSlug: "customer-support",
  nodes: [],
  counts: {
    folders: 0,
    docs: 0,
    bases: 0,
    records: 0,
    skills: 1,
    airapps: 1,
    drives: 0,
    files: 0,
  },
  collisions: [],
  warnings: [],
  requiresAutoMerge: false,
  applicable: true,
};

function PackageSummaryProbe({
  initialPackageName,
  plan: planOverride,
}: {
  initialPackageName?: string;
  plan?: InstallPlanVO;
}) {
  const messages = useCoreI18n();
  return (
    <PackageSummary
      initialPackageName={initialPackageName}
      messages={messages}
      plan={planOverride ?? plan}
    />
  );
}

const renderSummary = (
  initialPackageName?: string,
  locale: "en" | "zh-CN" = "en",
  planOverride?: InstallPlanVO,
) =>
  renderToStaticMarkup(
    <CoreI18nProvider locale={locale}>
      <PackageSummaryProbe initialPackageName={initialPackageName} plan={planOverride} />
    </CoreI18nProvider>,
  );

describe("PackageSummary", () => {
  it("omits the repeated summary when opened from a Template Center detail", () => {
    expect(renderSummary("Customer Support")).toBe("");
  });

  it("keeps the summary for the manual Install from GitHub flow", () => {
    const markup = renderSummary();

    expect(markup).toContain("Customer Support");
    expect(markup).toContain("A ready-to-use customer support workspace");
    expect(markup).toContain("busabase/templates");
  });

  it("renders the active locale of a locale-keyed description", () => {
    const localizedPlan: InstallPlanVO = {
      ...plan,
      package: {
        ...plan.package,
        description: { en: "A ready-to-use customer support workspace", "zh-CN": "客户支持工作台" },
      },
    };

    const zh = renderSummary(undefined, "zh-CN", localizedPlan);
    expect(zh).toContain("客户支持工作台");
    expect(zh).not.toContain("A ready-to-use customer support workspace");
  });

  it("hides the description span instead of an empty tag when every locale is blank", () => {
    const blankPlan: InstallPlanVO = {
      ...plan,
      package: { ...plan.package, description: { en: "", "zh-CN": "" } },
    };

    const markup = renderSummary(undefined, "en", blankPlan);
    expect(markup).toContain("Customer Support");
    expect(markup).not.toMatch(/<span[^>]*><\/span>/);
  });

  it("falls back to the identity name when the package declares no displayName", () => {
    const markup = renderSummary();
    expect(markup).toContain("Customer Support");
  });

  it("prefers a locale-keyed displayName over the identity name", () => {
    const withDisplayName: InstallPlanVO = {
      ...plan,
      package: {
        ...plan.package,
        displayName: { en: "Support Desk", "zh-CN": "客服工作台" },
      },
    };

    const zh = renderSummary(undefined, "zh-CN", withDisplayName);
    expect(zh).toContain("客服工作台");
    expect(zh).not.toContain("Customer Support");

    const en = renderSummary(undefined, "en", withDisplayName);
    expect(en).toContain("Support Desk");
  });
});
