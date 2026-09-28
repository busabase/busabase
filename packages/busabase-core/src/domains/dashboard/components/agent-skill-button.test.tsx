import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import {
  AgentIntegrationContent,
  AgentIntegrationPluginCards,
  createAgentSkillPrompt,
} from "./agent-skill-button";

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

describe("AgentIntegrationContent onboarding copy", () => {
  it.each([
    {
      locale: "en" as const,
      expected:
        "It reuses a connected Busabase MCP integration when available; otherwise it signs in. It then installs the permanent Busabase skills.",
      excluded: "CLI-based agents",
    },
    {
      locale: "zh-CN" as const,
      expected:
        "它会优先复用已连接的 Busabase MCP 集成，否则先登录；连接后再安装常驻的 Busabase 技能。",
      excluded: "CLI 智能体",
    },
    {
      locale: "ja" as const,
      expected:
        "接続済みの Busabase MCP があれば再利用し、なければログインします。接続後、常設の Busabase スキルをインストールします。",
      excluded: "CLI エージェント",
    },
  ])("keeps $locale onboarding agent-neutral", ({ locale, expected, excluded }) => {
    const markup = renderToStaticMarkup(
      <CoreI18nProvider locale={locale}>
        <AgentIntegrationContent
          defaultOrigin="https://app.busabase.com"
          edition="cloud"
          editionConfirmed
          targetSpaceId="space_cloud"
        />
      </CoreI18nProvider>,
    );

    expect(markup).toContain(expected);
    expect(markup).not.toContain(excluded);
  });
});

describe("createAgentSkillPrompt", () => {
  const locales = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "pt", "vi", "fr", "de"] as const;

  it.each(locales)("keeps the URL and space id verbatim in %s", (locale) => {
    const prompt = createAgentSkillPrompt("https://x.test/SETUP_SKILL.md", locale, "space_1");
    expect(prompt).toContain("https://x.test/SETUP_SKILL.md");
    expect(prompt).toContain("space_1");
    expect(prompt).toContain("BUSABASE_SPACE_ID / x-busabase-space");
    expect(prompt).toContain("Busabase Agent Skill");
  });

  it("gives every locale its own wording and falls back to English for unknown ones", () => {
    const english = createAgentSkillPrompt("https://x.test/s.md", "en");
    for (const locale of locales.filter((l) => l !== "en")) {
      expect(createAgentSkillPrompt("https://x.test/s.md", locale)).not.toBe(english);
    }
    expect(createAgentSkillPrompt("https://x.test/s.md", "xx")).toBe(english);
  });
});
