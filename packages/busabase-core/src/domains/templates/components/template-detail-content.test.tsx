import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TemplateDetailContent } from "./template-detail-content";

Object.assign(globalThis, { React });

const template: TemplateCardVO = {
  id: "busabase/templates/templates/busa-email",
  name: "busa-email",
  description: "Email operations workspace",
  category: "Operations",
  tags: [],
  screenshots: [],
  agentPrompts: ["Draft a reply to the latest customer email"],
  stats: {
    folders: 1,
    docs: 1,
    bases: 2,
    records: 3,
    files: 0,
    airapps: 1,
    skill: true,
  },
  install: {
    repoUrl: "https://github.com/busabase/templates/tree/main/templates/busa-email",
    intoFolder: "busa-email",
  },
  sourceUrl: "https://github.com/busabase/templates/tree/main/templates/busa-email",
};

const getHeading = (markup: string, title: string) =>
  [...markup.matchAll(/<h2([^>]*)>([\s\S]*?)<\/h2>/g)].find((match) => match[2]?.includes(title));

describe("TemplateDetailContent", () => {
  it("renders large section headings with matching-size icons and Busabase terms", () => {
    const markup = renderToStaticMarkup(<TemplateDetailContent template={template} />);
    const promptsHeading = getHeading(markup, "What you can ask an agent, once it is installed");
    const contentsHeading = getHeading(markup, "What installing this creates");

    expect(markup).toMatch(/^<div class="flex flex-col gap-12">/);
    expect(markup).not.toMatch(/^<div class="flex flex-col gap-6">/);

    expect(promptsHeading?.[1]).toContain("text-lg");
    expect(promptsHeading?.[1]).not.toContain("text-sm");
    expect(promptsHeading?.[1]).toContain("items-center");
    expect(promptsHeading?.[1]).not.toContain("items-baseline");
    expect(promptsHeading?.[2]).toContain("lucide-message-square");
    expect(promptsHeading?.[2]).toContain("size-[1em]");

    expect(contentsHeading?.[1]).toContain("text-lg");
    expect(contentsHeading?.[1]).not.toContain("text-sm");
    expect(contentsHeading?.[1]).toContain("items-center");
    expect(contentsHeading?.[1]).not.toContain("items-baseline");
    expect(contentsHeading?.[2]).toContain("lucide-package-open");
    expect(contentsHeading?.[2]).toContain("size-[1em]");

    expect(markup).toContain("lucide-external-link size-3");
    expect(markup).toContain(">Bases</dt>");
    expect(markup).not.toContain(">Tables</dt>");
  });
});
