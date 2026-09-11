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

  it("renders the requested locale of a locale-keyed description", () => {
    const localized: TemplateCardVO = {
      ...template,
      description: { en: "Email operations workspace", "zh-CN": "邮件运营工作台" },
    };

    const zh = renderToStaticMarkup(
      <TemplateDetailContent template={localized} descriptionLocale="zh-CN" />,
    );
    expect(zh).toContain("邮件运营工作台");
    expect(zh).not.toContain("Email operations workspace");

    const en = renderToStaticMarkup(<TemplateDetailContent template={localized} />);
    expect(en).toContain("Email operations workspace");
  });

  it("falls back to name when the template declares no displayName", () => {
    const markup = renderToStaticMarkup(<TemplateDetailContent template={template} />);
    expect(markup).toContain(">busa-email</h1>");
  });

  it("prefers a locale-keyed displayName over the identity name", () => {
    const withDisplayName: TemplateCardVO = {
      ...template,
      displayName: { en: "Busa Email", "zh-CN": "Busa 邮件" },
    };

    const zh = renderToStaticMarkup(
      <TemplateDetailContent template={withDisplayName} descriptionLocale="zh-CN" />,
    );
    expect(zh).toContain(">Busa 邮件</h1>");
    expect(zh).not.toContain(">busa-email</h1>");

    const en = renderToStaticMarkup(<TemplateDetailContent template={withDisplayName} />);
    expect(en).toContain(">Busa Email</h1>");
  });
});

describe("TemplateDetailContent — demo clip", () => {
  it("offers a play control, and does not mount the video until it is opened", () => {
    const withVideo: TemplateCardVO = {
      ...template,
      screenshots: ["https://cdn.example/cover.webp"],
      video: "https://media.githubusercontent.com/media/o/r/main/t/assets/recordings/t.mp4",
    };
    const markup = renderToStaticMarkup(<TemplateDetailContent template={withVideo} />);

    expect(markup).toContain("Play the demo");
    // The cover carries the preview; the clip itself only exists once the
    // dialog is open, which is what keeps a gallery page from fetching a
    // megabyte per card.
    expect(markup).toContain("https://cdn.example/cover.webp");
    expect(markup).not.toContain("<video");
  });

  it("renders no play control when the template declares no clip", () => {
    const markup = renderToStaticMarkup(<TemplateDetailContent template={template} />);
    expect(markup).not.toContain("Play the demo");
  });
});

describe("TemplateDetailContent — clip without screenshots", () => {
  it("still offers the clip when the template ships no screenshots at all", () => {
    const clipOnly: TemplateCardVO = {
      ...template,
      screenshots: [],
      video: "https://media.githubusercontent.com/media/o/r/main/t/assets/recordings/t.mp4",
    };
    const markup = renderToStaticMarkup(<TemplateDetailContent template={clipOnly} />);
    expect(markup).toContain("Play the demo");
  });
});
