// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { InstallPlanVO } from "busabase-contract/domains/install/types";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("shows the template resource install command and matching instructions", () => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AgentInstallPanel
          plan={{
            ...plan,
            package: { ...plan.package, name: "Busa Drama" },
            source: {
              owner: "busabase",
              repo: "templates",
              subdir: "templates/busa-drama",
            },
          }}
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain(
      "npx --yes busabase-cli@latest install https://github.com/busabase/templates/tree/main --skill busa-drama",
    );
    expect(markup).toContain(
      "npx skills add https://github.com/busabase/templates/tree/main/templates/busa-drama",
    );
    expect(markup).toContain("installs the template&#x27;s folders, tables, app");
    expect(markup).toContain("Read the installed local SKILL.md");
    expect(markup).toContain("do not repeat initialization or resubmit pending requests");
    expect(markup).toContain("local skill path");
    expect(markup).toContain("change requests waiting for review");
    expect(markup).not.toContain("do not create, change or delete anything");
    expect(markup).not.toContain("nothing in this space is created or changed");
  });

  it("keeps connection guidance inside the single copyable prompt", () => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AgentInstallPanel
          agentIntegration={{
            edition: "cloud",
            defaultOrigin: "https://ssr-placeholder.example",
            promptOrigin: "https://app.preview.example:8443",
            targetSpaceId: "space_cloud",
          }}
          plan={plan}
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain("https://app.preview.example:8443/SETUP_SKILL.md");
    expect(markup).not.toContain("ssr-placeholder.example");
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

describe("AgentInstallPanel prompt handoff", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the same stable URL in hydrated preview, clipboard, and manual fallback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <CoreI18nProvider locale="en">
        <AgentInstallPanel
          plan={plan}
          agentIntegration={{
            edition: "cloud",
            defaultOrigin: "https://placeholder.example",
            promptOrigin: "https://app.preview.example:8443",
            targetSpaceId: "space_original",
          }}
        />
      </CoreI18nProvider>,
    );
    const preview = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(preview.value).toContain(
      "https://app.preview.example:8443/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=space_original",
    );
    expect(preview.value).not.toContain(window.location.origin);
    const snapshot = preview.value;
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(snapshot));
    writeText.mockRejectedValueOnce(new Error("Permission denied"));
    const select = vi.spyOn(preview, "select");
    fireEvent.click(screen.getByRole("button", { name: "Copied" }));
    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(preview.value).toBe(snapshot);
  });

  it("retains Desktop browser origin and excludes stray cloud space IDs", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <CoreI18nProvider locale="en">
        <AgentInstallPanel
          plan={plan}
          agentIntegration={{
            edition: "desktop",
            targetSpaceId: "space_cloud",
          }}
        />
      </CoreI18nProvider>,
    );
    const preview = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(preview.value).toContain(
      `${window.location.origin}/SETUP_SKILL.md?edition=desktop&editionConfirmed=1`,
    );
    expect(preview.value).not.toContain("space_cloud");
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(preview.value));
  });

  it("does not expose a copyable install prompt without Cloud config", () => {
    render(
      <CoreI18nProvider locale="en">
        <AgentInstallPanel
          plan={plan}
          agentIntegration={{ edition: "cloud", promptOrigin: null }}
        />
      </CoreI18nProvider>,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("unavailable");
  });
});
