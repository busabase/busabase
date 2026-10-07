import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  demoteTocH1,
  getSafeMarkdownToc,
  SafeMarkdown,
  sanitizeLandingPageHtml,
  withDemotedH1,
} from "../src/fumadocs";

const render = async (markdown: string, demoteH1?: boolean) =>
  renderToStaticMarkup(await SafeMarkdown({ children: markdown, demoteH1 }));
const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

describe("Fumadocs content helpers", () => {
  it("builds heading anchors for stored Markdown", async () => {
    await expect(getSafeMarkdownToc("# Intro\n\n## Typed reads")).resolves.toEqual([
      expect.objectContaining({ title: "Intro", url: "#user-content-intro", depth: 1 }),
      expect.objectContaining({
        title: "Typed reads",
        url: "#user-content-typed-reads",
        depth: 2,
      }),
    ]);
  });

  it("points every TOC entry at an id SafeMarkdown actually renders", async () => {
    const body = "# Title\n\n## Decision\n\n## 中文 标题\n\n## Decision\n\n### Deep";
    const rendered = ids(await render(body));
    const toc = await getSafeMarkdownToc(body);
    expect(toc).toHaveLength(5);
    for (const item of toc) expect(rendered).toContain(item.url.slice(1));
  });

  it("points in-body fragment links at the rendered heading ids", async () => {
    const html = await render(
      "## Decision\n\n## 中文 标题\n\n[a](#decision) [b](#中文-标题) [c](#missing) [d](https://x.test/#decision)",
    );
    expect(html).toContain('href="#user-content-decision"');
    expect(html).toContain('href="#user-content-中文-标题"');
    expect(html).toContain('href="#missing"');
    expect(html).toContain('href="https://x.test/#decision"');
  });

  it("keeps GFM footnote references and back-references linked both ways", async () => {
    const html = await render("See[^1].\n\n[^1]: A note.");
    const rendered = ids(html);
    const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThanOrEqual(2);
    for (const target of targets) expect(rendered).toContain(target);
    expect(html).not.toContain("user-content-user-content-");
  });

  it("renders body H1 as H2 only when asked, with the same ids", async () => {
    const body = "# Buda vs Cursor\n\n## Decision\n\n```md\n# not a heading\n```";
    const plain = await render(body);
    const demoted = await render(body, true);
    expect(plain.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(demoted).not.toMatch(/<h1[\s>]/);
    expect(demoted.match(/<h2[\s>]/g)).toHaveLength(2);
    expect(ids(demoted)).toEqual(ids(plain));
    expect(demoted).toContain("# not a heading");
  });

  it("reports demoted TOC depths to match the demoted body", async () => {
    const toc = await getSafeMarkdownToc("# Title\n\n## Section\n\n### Deep", { demoteH1: true });
    expect(toc.map((item) => item.depth)).toEqual([2, 2, 3]);
    expect(demoteTocH1([{ title: "A", url: "#a", depth: 1 }])).toEqual([
      { title: "A", url: "#a", depth: 2 },
    ]);
  });

  it("demotes H1 through the caller's own h2 component and keeps props", () => {
    const h2 = (props: { id?: string; children?: unknown }) =>
      createElement("h2", { ...props, "data-custom": "yes" });
    const { h1 } = withDemotedH1({ h2 });
    expect(renderToStaticMarkup(h1({ id: "intro", className: "x", children: "Title" }))).toBe(
      '<h2 id="intro" class="x" data-custom="yes">Title</h2>',
    );
    expect(renderToStaticMarkup(withDemotedH1().h1({ children: "T" }))).toBe("<h2>T</h2>");
  });

  it("does not pass raw HTML through when demoting", async () => {
    const html = await render("# Title\n\n<script>alert(1)</script>", true);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<h1");
  });

  it("removes executable HTML while preserving semantic Landing Page markup", () => {
    const html = sanitizeLandingPageHtml(`
      <article class="landing" style="display:grid;gap:24px;background:linear-gradient(135deg,#fff,#eee);font-family:Inter,system-ui;text-transform:uppercase;border-bottom:1px solid #ddd;border-left:4px solid #111;position:fixed;background-image:url(javascript:alert(1));width:calc(url(https://attacker.test/pixel))"><h1>Safe</h1>
        <script>alert(1)</script>
        <a href="javascript:alert(1)" onclick="alert(1)">bad</a>
        <a href="https://busabase.com" target="_blank">good</a>
        <img src="https://cdn.example.com/cover.png" onerror="alert(1)">
      </article>
    `);

    expect(html).toContain('<article style="');
    expect(html).not.toContain('class="landing"');
    expect(html).toContain("<h1>Safe</h1>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("position");
    expect(html).not.toContain("background-image");
    expect(html).not.toContain("attacker.test");
    expect(html).toContain("display:grid");
    expect(html).toContain("gap:24px");
    expect(html).toContain("background:linear-gradient(135deg,#fff,#eee)");
    expect(html).toContain("font-family:Inter,system-ui");
    expect(html).toContain("text-transform:uppercase");
    expect(html).toContain("border-bottom:1px solid #ddd");
    expect(html).toContain("border-left:4px solid #111");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('src="https://cdn.example.com/cover.png"');
  });
});
