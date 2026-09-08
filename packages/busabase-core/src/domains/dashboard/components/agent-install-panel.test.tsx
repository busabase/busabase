import type { InstallPlanVO } from "busabase-contract/domains/install/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { AgentInstallPanel } from "./agent-install-panel";

const getButtonClasses = (markup: string, label: string) => {
  const button = [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].find((match) =>
    match[2]?.includes(label),
  );
  return button?.[1]?.match(/class="([^"]*)"/)?.[1] ?? "";
};

const plan: InstallPlanVO = {
  package: {
    name: "Kelly Email",
    description: "Email workflow",
    tags: [],
  },
  source: {
    owner: "busabase",
    repo: "skills",
    ref: "main",
    subdir: "skills/kelly-email",
  },
  targetFolderSlug: "kelly-email",
  nodes: [],
  counts: {
    folders: 0,
    docs: 0,
    bases: 0,
    records: 0,
    skills: 1,
    airapps: 0,
    drives: 0,
    files: 0,
  },
  collisions: [],
  warnings: [],
  requiresAutoMerge: false,
  applicable: true,
};

describe("AgentInstallPanel", () => {
  it("keeps connection guidance inside the single copyable prompt", () => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AgentInstallPanel
          agentIntegration={{
            edition: "cloud",
            defaultOrigin: "https://app.busabase.com",
            targetSpaceId: "space_cloud",
          }}
          plan={plan}
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain("SETUP_SKILL.md");
    expect(markup).toContain("space_cloud");
    expect(markup).toContain("npx skills add busabase/skills --skill kelly-email");
    expect(markup).not.toContain("Your agent still needs access to this space");
    expect(markup).not.toContain("Connect your agent");
    expect(markup).not.toContain("Installs the repository&#x27;s default branch");
    expect(markup).toMatch(/<div class="flex justify-end"><button/);

    const copyPromptClasses = getButtonClasses(markup, "Copy prompt");
    expect(copyPromptClasses).toContain("bg-primary");
    expect(copyPromptClasses).toContain("text-primary-foreground");
    expect(copyPromptClasses).toContain("hover:bg-primary/90");
    expect(copyPromptClasses).not.toContain("bg-background");
    expect(copyPromptClasses).not.toContain("border-input");
  });

  it("offers a way out for a user who has no agent yet", () => {
    const withHost = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AgentInstallPanel onCreateNode={() => {}} plan={plan} />
      </CoreI18nProvider>,
    );
    expect(withHost).toContain("No agent set up yet?");

    // Hosts that cannot open a New-item modal must not paint a dead link.
    const withoutHost = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AgentInstallPanel plan={plan} />
      </CoreI18nProvider>,
    );
    expect(withoutHost).not.toContain("No agent set up yet?");
  });

  it("keeps the way out on the no-skill branch, where the tab has nothing else", () => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AgentInstallPanel
          onCreateNode={() => {}}
          plan={{ ...plan, counts: { ...plan.counts, skills: 0 } }}
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain("This package carries no agent manual");
    expect(markup).toContain("No agent set up yet?");
  });
});
