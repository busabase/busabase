import { describe, expect, it } from "vitest";
import { getSafeMarkdownToc, sanitizeLandingPageHtml } from "../src/fumadocs";

describe("Fumadocs content helpers", () => {
  it("builds heading anchors for stored Markdown", async () => {
    await expect(getSafeMarkdownToc("# Intro\n\n## Typed reads")).resolves.toEqual([
      expect.objectContaining({ title: "Intro", url: "#intro", depth: 1 }),
      expect.objectContaining({ title: "Typed reads", url: "#typed-reads", depth: 2 }),
    ]);
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
