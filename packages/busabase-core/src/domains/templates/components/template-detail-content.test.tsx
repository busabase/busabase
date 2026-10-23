import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fmt } from "../../../i18n/fmt";
import { dashboardZhCN } from "../../../i18n/zh-CN";
import { TemplateCardSummary } from "./template-card-summary";
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
  it("leads with a large title and a readable description, then the action", () => {
    const markup = renderToStaticMarkup(
      <TemplateDetailContent
        template={template}
        actions={<button type="button">Install</button>}
      />,
    );
    const h1 = markup.match(/<h1([^>]*)>/)?.[1] ?? "";
    expect(h1).toContain("text-4xl");
    expect(h1).toContain("@4xl:text-6xl");
    expect(h1).toContain("font-serif");

    // The action sits under the description, not in a corner beside the title.
    const description = markup.indexOf("Email operations workspace");
    const action = markup.indexOf(">Install</button>");
    expect(description).toBeGreaterThan(markup.indexOf("</h1>"));
    expect(action).toBeGreaterThan(description);
    expect(action).toBeLessThan(markup.indexOf("</header>"));
  });

  it("keeps category, version and tags off the title line", () => {
    const tagged: TemplateCardVO = {
      ...template,
      category: "sales-crm",
      version: "0.1.0",
      license: "MIT",
      tags: ["sales-crm", "pipeline", "risk:gated-write", "surface:busabase"],
    };
    const markup = renderToStaticMarkup(<TemplateDetailContent template={tagged} />);
    const header = markup.slice(0, markup.indexOf("</header>"));
    expect(header).not.toContain("sales-crm");
    expect(header).not.toContain("0.1.0");

    // They live in the side column instead — plain tags once each, category first.
    const aside = markup.slice(markup.indexOf("<aside"));
    expect(aside).toContain("<li>sales-crm</li><li>pipeline</li>");
    expect(aside).toContain("v0.1.0 · MIT");
  });

  it("never renders an internal prefix:value tag", () => {
    const tagged: TemplateCardVO = {
      ...template,
      tags: ["risk:gated-write", "surface:busabase", "industry:legal"],
    };
    const markup = renderToStaticMarkup(<TemplateDetailContent template={tagged} />);
    expect(markup).not.toContain("risk:");
    expect(markup).not.toContain("surface:");
    expect(markup).not.toContain("industry:");
    // Only the category is left to show.
    expect(markup).toContain("<li>Operations</li>");
  });

  it("puts what installing creates, and who may install, in the quiet side column", () => {
    const markup = renderToStaticMarkup(<TemplateDetailContent template={template} />);
    const aside = markup.slice(markup.indexOf("<aside"), markup.indexOf("</aside>"));

    expect(aside).toContain("What installing this creates");
    expect(aside).toContain(">Bases</dt>");
    expect(aside).not.toContain(">Tables</dt>");
    expect(aside).toContain("Installing needs an owner or admin of the workspace.");
    expect(aside).toContain("lucide-external-link size-3");
    // Small type, not a full-width table: section labels are text-sm, and the
    // permission note is the smallest print on the page.
    expect(aside).toMatch(
      /<h2 class="font-sans text-sm font-medium">What installing this creates<\/h2>/,
    );
    expect(aside).toMatch(/<p class="text-xs[^"]*">Installing needs an owner or admin/);
    expect(markup).not.toContain("Send the content for review first");
  });

  it("keeps the agent prompts as a secondary section beside the side column", () => {
    const markup = renderToStaticMarkup(<TemplateDetailContent template={template} />);
    const heading = getHeading(markup, "What you can ask an agent, once it is installed");
    expect(heading?.[1]).toContain("text-base");
    expect(heading?.[1]).not.toContain("text-lg");
    expect(heading?.[2]).toContain("lucide-message-square");
    expect(markup).toContain("@3xl:col-span-2");
    expect(markup.indexOf("Draft a reply")).toBeLessThan(markup.indexOf("<aside"));
  });

  it("gives the side column the full width when there are no prompts", () => {
    const markup = renderToStaticMarkup(
      <TemplateDetailContent template={{ ...template, agentPrompts: [] }} />,
    );
    expect(markup).not.toContain("What you can ask an agent");
    expect(markup).not.toContain("@3xl:grid-cols-3");
    expect(markup).toContain("<aside");
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

    // A locale the catalog has no entry for shows English — never another
    // language that merely happens to be listed first.
    const ja = renderToStaticMarkup(
      <TemplateDetailContent template={localized} descriptionLocale="ja" />,
    );
    expect(ja).toContain("Email operations workspace");
    expect(ja).not.toContain("邮件运营工作台");
  });

  it("uses caller-provided UI labels in a server-rendered template detail", () => {
    const labels = {
      ...dashboardZhCN.templates,
      screenshot: (number: number) => fmt(dashboardZhCN.templates.screenshot, { number }),
    };
    const localized: TemplateCardVO = {
      ...template,
      tags: ["customer-ops"],
      screenshots: ["https://cdn.example/cover.webp"],
      video: "https://cdn.example/demo.mp4",
    };
    const markup = renderToStaticMarkup(
      <TemplateDetailContent template={localized} labels={labels} descriptionLocale="zh-CN" />,
    );

    expect(markup).toContain(dashboardZhCN.templates.promptsTitle);
    expect(markup).toContain(dashboardZhCN.templates.contentsTitle);
    expect(markup).toContain(`>${dashboardZhCN.templates.bases}</dt>`);
    expect(markup).toContain(dashboardZhCN.templates.playVideo);
    expect(markup).toContain(`>${dashboardZhCN.templates.tags}</h2>`);
    expect(markup).toContain(dashboardZhCN.templates.permissionNote);
    expect(markup).not.toContain("What installing this creates");
  });

  it("shows a card as cover, name and description only — no stats row", () => {
    const markup = renderToStaticMarkup(
      <TemplateCardSummary
        template={{ ...template, screenshots: ["https://cdn.example/cover.webp"] }}
        screenshotAlt=""
        density="comfortable"
      />,
    );
    expect(markup).toContain("https://cdn.example/cover.webp");
    expect(markup).toContain(">busa-email</h3>");
    expect(markup).toContain("Email operations workspace");
    expect(markup).toContain("line-clamp-2");
    expect(markup).not.toMatch(/\d+ tables?/);
    expect(markup).not.toMatch(/sample rows?/);
    expect(markup).not.toContain("lucide-table");
    // Event-free: the caller decides whether the whole card is a link or a button.
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("<button");
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

    const ja = renderToStaticMarkup(
      <TemplateCardSummary template={withDisplayName} screenshotAlt="" descriptionLocale="ja" />,
    );
    expect(ja).toContain(">Busa Email</h3>");
    expect(ja).not.toContain("Busa 邮件");
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

describe("TemplateDetailContent — several clips", () => {
  const COVER = "https://cdn.example/cover.webp";
  const SHOT = "https://cdn.example/overview.webp";
  const LAST = "https://cdn.example/last.webp";
  const clip = (name: string, title?: string) => ({
    src: `https://media.githubusercontent.com/media/o/r/main/t/assets/recordings/${name}.mp4`,
    ...(title ? { title } : {}),
  });
  const several: TemplateCardVO = {
    ...template,
    screenshots: [COVER, SHOT, LAST],
    video: clip("tour").src,
    videos: [clip("tour", "30-second tour"), clip("full", "Full walkthrough")],
    locales: { "zh-CN": { videos: [clip("tour-zh-CN", "30 秒看懂")] } },
  };
  const plays = (markup: string) => markup.split("Play the demo").length - 1;

  it("renders one play control per clip, each named after its title", () => {
    const markup = renderToStaticMarkup(<TemplateDetailContent template={several} />);
    expect(plays(markup)).toBe(2);
    expect(markup).toContain('aria-label="Play the demo: 30-second tour"');
    expect(markup).toContain('aria-label="Play the demo: Full walkthrough"');
    // Same cover on every tile, so the title is also printed on it.
    expect(markup).toContain(">30-second tour</span>");
    expect(markup).toContain(">Full walkthrough</span>");
    expect(markup).not.toContain("<video");
  });

  it("shelves the clips after the cover and before the other screenshots", () => {
    const markup = renderToStaticMarkup(<TemplateDetailContent template={several} />);
    const cover = markup.indexOf(COVER);
    const first = markup.indexOf("30-second tour");
    const second = markup.indexOf("Full walkthrough");
    const last = markup.indexOf(LAST);
    expect(cover).toBeGreaterThan(-1);
    expect(cover).toBeLessThan(first);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(last);
  });

  it("prints no caption on a lone clip, titled or not, so its tile stays as it was", () => {
    const lone: TemplateCardVO = {
      ...template,
      screenshots: [COVER],
      video: clip("tour").src,
      videos: [clip("tour", "30-second tour")],
    };
    const markup = renderToStaticMarkup(<TemplateDetailContent template={lone} />);
    expect(plays(markup)).toBe(1);
    expect(markup).not.toContain(">30-second tour</span>");
  });

  it("shows at most three clips however many are declared", () => {
    const many: TemplateCardVO = {
      ...template,
      screenshots: [COVER],
      videos: ["a", "b", "c", "d", "e"].map((name) => clip(name, `Clip ${name}`)),
    };
    const markup = renderToStaticMarkup(<TemplateDetailContent template={many} />);
    expect(plays(markup)).toBe(3);
    expect(markup).toContain("Clip c");
    expect(markup).not.toContain("Clip d");
  });

  it("gives a locale its own list whole, and a locale without one the default list", () => {
    const zh = renderToStaticMarkup(
      <TemplateDetailContent template={several} descriptionLocale="zh-CN" />,
    );
    expect(plays(zh)).toBe(1);
    expect(zh).toContain("30 秒看懂");
    expect(zh).not.toContain("Full walkthrough");

    const ja = renderToStaticMarkup(
      <TemplateDetailContent template={several} descriptionLocale="ja" />,
    );
    expect(plays(ja)).toBe(2);
    expect(ja).not.toContain("30 秒看懂");
  });

  it("renders a clip list even when the template ships no screenshots", () => {
    const clipsOnly: TemplateCardVO = {
      ...template,
      screenshots: [],
      videos: [clip("a", "A"), clip("b", "B")],
    };
    expect(plays(renderToStaticMarkup(<TemplateDetailContent template={clipsOnly} />))).toBe(2);
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

/**
 * Media follows the same locale the text does, with the same English
 * fallback — and a card with no `locales` (every card an older catalog
 * produced) renders exactly as it did before.
 */
describe("TemplateDetailContent — localized media", () => {
  const EN_COVER = "https://cdn.example/cover.webp";
  const EN_SHOT = "https://cdn.example/overview.webp";
  const EN_CLIP = "https://cdn.example/demo.mp4";
  const ZH_COVER = "https://cdn.example/cover-zh-CN.webp";
  const ZH_SHOT = "https://cdn.example/overview-zh-CN.webp";
  const ZH_CLIP = "https://cdn.example/demo-zh-CN.mp4";

  const localized: TemplateCardVO = {
    ...template,
    screenshots: [EN_COVER, EN_SHOT],
    video: EN_CLIP,
    locales: {
      "zh-CN": { screenshots: [ZH_COVER, ZH_SHOT], video: ZH_CLIP },
      ko: { video: "https://cdn.example/demo-ko.mp4" },
    },
  };

  it("shows a zh-CN viewer the zh-CN gallery and nothing from the English one", () => {
    const markup = renderToStaticMarkup(
      <TemplateDetailContent template={localized} descriptionLocale="zh-CN" />,
    );
    expect(markup).toContain(ZH_COVER);
    expect(markup).toContain(ZH_SHOT);
    expect(markup).not.toContain(EN_COVER);
    expect(markup).not.toContain(EN_SHOT);
  });

  it("shows a ja viewer, who has no entry, the English gallery", () => {
    const markup = renderToStaticMarkup(
      <TemplateDetailContent template={localized} descriptionLocale="ja" />,
    );
    expect(markup).toContain(EN_COVER);
    expect(markup).not.toContain(ZH_COVER);
  });

  it("keeps the English screenshots for a locale that only localized its clip", () => {
    const markup = renderToStaticMarkup(
      <TemplateDetailContent template={localized} descriptionLocale="ko" />,
    );
    expect(markup).toContain(EN_COVER);
    expect(markup).toContain("Play the demo");
  });

  it("puts the viewer's own cover on the catalog card", () => {
    const zh = renderToStaticMarkup(
      <TemplateCardSummary template={localized} screenshotAlt="" descriptionLocale="zh-CN" />,
    );
    expect(zh).toContain(ZH_COVER);
    expect(zh).not.toContain(EN_COVER);

    const ja = renderToStaticMarkup(
      <TemplateCardSummary template={localized} screenshotAlt="" descriptionLocale="ja" />,
    );
    expect(ja).toContain(EN_COVER);
  });

  it("renders a card without locales identically in every language", () => {
    const { locales: _locales, ...plain } = localized;
    const en = renderToStaticMarkup(<TemplateDetailContent template={plain} />);
    const zh = renderToStaticMarkup(
      <TemplateDetailContent template={plain} descriptionLocale="zh-CN" />,
    );
    expect(en).toContain(EN_COVER);
    expect(zh).toContain(EN_COVER);
    expect(zh).toContain(EN_SHOT);
  });
});
