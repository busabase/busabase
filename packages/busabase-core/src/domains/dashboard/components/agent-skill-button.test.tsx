import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { AgentIntegrationContent, AgentIntegrationPluginCards } from "./agent-skill-button";

const getButtonClasses = (markup: string, label: string) => {
  const button = [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].find((match) =>
    match[2]?.includes(label),
  );
  return button?.[1]?.match(/class="([^"]*)"/)?.[1] ?? "";
};

describe("AgentIntegrationPluginCards", () => {
  it("opens host-provided plugin destinations in a new tab", () => {
    const markup = renderToStaticMarkup(
      <AgentIntegrationPluginCards
        items={[
          {
            title: "Codex Plugin",
            description: "Connect Codex to a trusted knowledge base",
            href: "/codex-plugin",
            icon: "/assets/agents/codex.png",
          },
        ]}
      />,
    );

    expect(markup).toContain('href="/codex-plugin"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("uses the primary action style for the shell prompt copy button", () => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale="en">
        <AgentIntegrationContent
          defaultOrigin="https://app.busabase.com"
          edition="cloud"
          editionConfirmed
          targetSpaceId="space_cloud"
        />
      </CoreI18nProvider>,
    );

    const copyPromptClasses = getButtonClasses(markup, "Copy prompt");
    expect(copyPromptClasses).toContain("bg-primary");
    expect(copyPromptClasses).toContain("text-primary-foreground");
    expect(copyPromptClasses).toContain("hover:bg-primary/90");
    expect(copyPromptClasses).not.toContain("bg-card");
    expect(copyPromptClasses).not.toContain("border-input");
  });
});
