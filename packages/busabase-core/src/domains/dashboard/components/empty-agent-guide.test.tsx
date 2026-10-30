import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { EmptyAgentGuide } from "./empty-agent-guide";

// The template CTA is a SPALink, so it needs a wouter location that does not
// reach for `window` under `renderToStaticMarkup` (see dashboard-shell.test).
const useStaticLocation = (): [string, (path: string) => void] => ["/home", () => undefined];
const useStaticSearch = () => "";

const render = (node: ReactNode, locale: "en" | "zh-CN" = "en") =>
  renderToStaticMarkup(
    <Router hook={useStaticLocation} searchHook={useStaticSearch}>
      <CoreI18nProvider locale={locale}>{node}</CoreI18nProvider>
    </Router>,
  );

describe("EmptyAgentGuide", () => {
  it("leads with the template path and demotes connecting an agent to a text link", () => {
    const markup = render(<EmptyAgentGuide edition="cloud" lang="en" onCreateNode={() => {}} />);

    // The primary action is the one that fills the workspace today. Asserting
    // on the class is the point: if "Start from a template" ever loses
    // `bg-primary` to something else on this card, the ordering this component
    // exists to fix has silently regressed.
    const templateLink = markup.match(/<a[^>]*href="\/templates"[^>]*>/)?.[0] ?? "";
    expect(templateLink).toContain("bg-primary");
    expect(markup).toContain("Start from a template");

    // Connecting an agent is step two, so it must NOT render as a filled button.
    const connectButton =
      [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].find((match) =>
        match[2]?.includes("Connect your agent"),
      )?.[1] ?? "";
    expect(connectButton).toContain("text-muted-foreground");
    expect(connectButton).not.toContain("bg-primary");

    // The old copy pointed at "the UI buttons" — a sidebar "+" a first-time
    // visitor cannot find. It is now a real button, so the hint must be gone.
    expect(markup).not.toContain("Or use the UI buttons to create manually.");
  });

  it("offers the manual create button only when the host provides one", () => {
    expect(render(<EmptyAgentGuide onCreateNode={() => {}} />)).toContain(
      "Create a Base or document",
    );
    // A host with no New-item modal (an embed) must not paint a dead button.
    expect(render(<EmptyAgentGuide />)).not.toContain("Create a Base or document");
    // …but the template path never depends on the host, so it always survives.
    expect(render(<EmptyAgentGuide />)).toContain('href="/templates"');
  });

  it("localizes every action on the card", () => {
    const markup = render(<EmptyAgentGuide onCreateNode={() => {}} />, "zh-CN");

    expect(markup).toContain("从模板开始");
    expect(markup).toContain("新建 Base 或文档");
    expect(markup).toContain("连接你的 Agent");
  });

  it("leads with connecting the agent, with the cue, when the host asks for it", () => {
    const markup = render(
      <EmptyAgentGuide
        agentCue={{ onDismiss: () => {} }}
        edition="cloud"
        onCreateNode={() => {}}
      />,
    );

    const buttons = [...markup.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
    const connect = buttons.find((match) => match[2]?.includes("Connect your agent"))?.[1] ?? "";
    // The agent CTA is now the filled primary and carries the attention ring…
    expect(connect).toContain("bg-ai");
    expect(connect).toContain('data-agent-cue="ring"');
    // …and the template is still one tap away, but no longer the primary.
    const templateLink = markup.match(/<a[^>]*href="\/templates"[^>]*>/)?.[0] ?? "";
    expect(templateLink).not.toContain("bg-primary");
    expect(markup).toContain("Create a Base or document");
    // The user can always say no.
    expect(buttons.some((match) => match[2]?.includes("Not now"))).toBe(true);
    // One pulsing button, one bubble pointing at it.
    expect(markup.match(/data-agent-cue="ring"/g)).toHaveLength(1);
    expect(markup.match(/data-agent-cue="bubble"/g)).toHaveLength(1);
  });

  it("keeps the template-first layout, with no cue, when the host omits it", () => {
    const markup = render(<EmptyAgentGuide onCreateNode={() => {}} />);
    expect(markup).not.toContain("data-agent-cue");
    expect(markup).not.toContain("Not now");
  });

  it("localizes the cue copy", () => {
    const markup = render(<EmptyAgentGuide agentCue={{ onDismiss: () => {} }} />, "zh-CN");
    expect(markup).toContain("连接你的 Agent");
    expect(markup).toContain("推荐的第一步");
    expect(markup).toContain("以后再说");
  });
});
