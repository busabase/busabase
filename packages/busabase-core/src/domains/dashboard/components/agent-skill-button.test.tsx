import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentIntegrationPluginCards } from "./agent-skill-button";

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
});
