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

function PackageSummaryProbe({ initialPackageName }: { initialPackageName?: string }) {
  const messages = useCoreI18n();
  return <PackageSummary initialPackageName={initialPackageName} messages={messages} plan={plan} />;
}

const renderSummary = (initialPackageName?: string) =>
  renderToStaticMarkup(
    <CoreI18nProvider locale="en">
      <PackageSummaryProbe initialPackageName={initialPackageName} />
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
});
