import { describe, expect, it } from "vitest";
import {
  buildCmsBreadcrumbJsonLd,
  buildCmsFaqJsonLd,
  buildCmsPageJsonLd,
  buildCmsWebPageJsonLd,
  type CmsJsonLdSite,
  extractCmsFaqEntries,
} from "../src/jsonld";

const SITE: CmsJsonLdSite = {
  baseUrl: "https://buda.im",
  siteName: "Buda",
  organizationId: "https://buda.im/#organization",
};

/**
 * Copied verbatim (inline styles and all) from the rendered body of
 * https://buda.im/gpt-6-astra — the page this whole change started from. Synthetic
 * markup would not have caught that the real blocks carry `style` attributes on
 * both <details> and <summary>, or that the answer is wrapped in a styled <p>.
 */
const REAL_FAQ_HTML = `
<details style="border-bottom:1px solid oklch(0.89 0.006 75 / 0.3);background:oklch(1 0 0)"><summary style="padding:20px 4px;color:oklch(0.15 0.005 60);font-size:16px;font-weight:600;line-height:1.4">What is GPT-6 Astra?</summary><p style="margin:0;color:oklch(0.42 0.008 65);font-size:15px;line-height:1.75;padding:0 4px 20px">GPT-6 Astra is OpenAI&#39;s frontier model for computer use, coding, professional work, science, browsing, and other complex agent tasks.</p></details>
<details style="border-bottom:1px solid oklch(0.89 0.006 75 / 0.3)"><summary style="padding:20px 4px">Is GPT-6 Astra available in Buda?</summary><p style="margin:0">Not yet. Buda has not announced Astra availability, supported plans, or a Credits multiplier.</p></details>
<details><summary>What is the GPT-6 Astra API model ID?</summary><p>OpenAI identifies the API model as gpt-6-astra.</p></details>
`;

describe("extractCmsFaqEntries", () => {
  it("pulls clean question/answer pairs out of the real rendered CMS markup", () => {
    const entries = extractCmsFaqEntries(REAL_FAQ_HTML);

    expect(entries).toEqual([
      {
        question: "What is GPT-6 Astra?",
        answer:
          "GPT-6 Astra is OpenAI's frontier model for computer use, coding, professional work, science, browsing, and other complex agent tasks.",
      },
      {
        question: "Is GPT-6 Astra available in Buda?",
        answer:
          "Not yet. Buda has not announced Astra availability, supported plans, or a Credits multiplier.",
      },
      {
        question: "What is the GPT-6 Astra API model ID?",
        answer: "OpenAI identifies the API model as gpt-6-astra.",
      },
    ]);
  });

  it("decodes HTML entities rather than leaking them into the schema", () => {
    const [entry] = extractCmsFaqEntries(
      "<details><summary>A &amp; B?</summary><p>Yes &#39;really&#39;</p></details>",
    );

    expect(entry).toEqual({ question: "A & B?", answer: "Yes 'really'" });
  });

  it("returns nothing for a body with no details blocks", () => {
    expect(extractCmsFaqEntries("<h2>Questions</h2><p>Not a disclosure widget.</p>")).toEqual([]);
  });

  // The whole point of the strictness: a wrong FAQPage is worse than none, because
  // it can be judged as structured-data spam and nobody notices a silent mis-pairing.
  it("skips a details block whose summary is not its first child", () => {
    expect(
      extractCmsFaqEntries(
        "<details><p>answer first</p><summary>question last</summary></details>",
      ),
    ).toEqual([]);
  });

  it("skips a details block with no summary at all", () => {
    expect(extractCmsFaqEntries("<details><p>orphan answer</p></details>")).toEqual([]);
  });

  it("skips a block with an empty question or an empty answer", () => {
    expect(extractCmsFaqEntries("<details><summary></summary><p>a</p></details>")).toEqual([]);
    expect(extractCmsFaqEntries("<details><summary>q</summary></details>")).toEqual([]);
  });

  it("emits nothing for nested details rather than pairing an outer question with an inner answer", () => {
    const nested =
      "<details><summary>outer</summary><details><summary>inner</summary><p>inner answer</p></details></details>";

    // The non-greedy match closes the outer block on the inner `</details>`, so the
    // captured region contains a nested `<details` and is refused; scanning then
    // resumes past the inner opening tag, leaving nothing else to match. Refusing the
    // whole ambiguous region is the intended outcome — a plausible-looking wrong pair
    // is the failure mode that matters here.
    expect(extractCmsFaqEntries(nested)).toEqual([]);
  });
});

describe("buildCmsFaqJsonLd", () => {
  it("emits a FAQPage with one Question node per entry", () => {
    const node = buildCmsFaqJsonLd(extractCmsFaqEntries(REAL_FAQ_HTML));

    expect(node).toMatchObject({
      "@context": "https://schema.org",
      "@type": "FAQPage",
    });
    expect(node?.mainEntity).toHaveLength(3);
    expect(node?.mainEntity[0]).toEqual({
      "@type": "Question",
      name: "What is GPT-6 Astra?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "GPT-6 Astra is OpenAI's frontier model for computer use, coding, professional work, science, browsing, and other complex agent tasks.",
      },
    });
  });

  it("emits nothing below two entries — one question is not a FAQ", () => {
    expect(buildCmsFaqJsonLd([{ question: "q", answer: "a" }])).toBeUndefined();
    expect(buildCmsFaqJsonLd([])).toBeUndefined();
  });
});

describe("buildCmsWebPageJsonLd", () => {
  it("describes the page in the language the body really is", () => {
    const node = buildCmsWebPageJsonLd(SITE, {
      url: "https://buda.im/gpt-6-astra",
      title: "GPT-6 Astra for Agent Workflows",
      description: "Explore GPT-6 Astra benchmarks.",
      lang: "en",
      dateModified: "2026-09-04T09:20:51.960Z",
    });

    expect(node).toEqual({
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": "https://buda.im/gpt-6-astra",
      url: "https://buda.im/gpt-6-astra",
      name: "GPT-6 Astra for Agent Workflows",
      description: "Explore GPT-6 Astra benchmarks.",
      inLanguage: "en",
      dateModified: "2026-09-04T09:20:51.960Z",
      isPartOf: { "@type": "WebSite", url: "https://buda.im", name: "Buda" },
      publisher: { "@id": "https://buda.im/#organization" },
    });
  });

  it("omits absent fields instead of emitting nulls", () => {
    const node = buildCmsWebPageJsonLd(
      { baseUrl: "https://x.test" },
      { url: "https://x.test/a", title: "A", lang: "en", description: null, dateModified: null },
    );

    expect(node).toEqual({
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": "https://x.test/a",
      url: "https://x.test/a",
      name: "A",
      inLanguage: "en",
    });
  });

  it("resolves a root-relative image against the site base URL", () => {
    const node = buildCmsWebPageJsonLd(SITE, {
      url: "https://buda.im/a",
      title: "A",
      lang: "en",
      image: "/opengraph-image",
    });

    expect(node.primaryImageOfPage).toEqual({
      "@type": "ImageObject",
      url: "https://buda.im/opengraph-image",
    });
  });

  it("leaves an already-absolute image URL alone", () => {
    const node = buildCmsWebPageJsonLd(SITE, {
      url: "https://buda.im/a",
      title: "A",
      lang: "en",
      image: "https://cdn.test/cover.webp",
    });

    expect(node.primaryImageOfPage).toEqual({
      "@type": "ImageObject",
      url: "https://cdn.test/cover.webp",
    });
  });

  it("inlines a publisher from siteName when the app emits no Organization node", () => {
    const node = buildCmsWebPageJsonLd(
      { baseUrl: "https://x.test", siteName: "X" },
      { url: "https://x.test/a", title: "A", lang: "en" },
    );

    expect(node.publisher).toEqual({ "@type": "Organization", name: "X", url: "https://x.test" });
  });
});

describe("buildCmsBreadcrumbJsonLd", () => {
  it("numbers the trail from 1", () => {
    const node = buildCmsBreadcrumbJsonLd([
      { name: "Home", url: "https://buda.im" },
      { name: "GPT-6 Astra", url: "https://buda.im/gpt-6-astra" },
    ]);

    expect(node).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://buda.im" },
        {
          "@type": "ListItem",
          position: 2,
          name: "GPT-6 Astra",
          item: "https://buda.im/gpt-6-astra",
        },
      ],
    });
  });

  it("emits nothing for a one-item trail, which is not navigation", () => {
    expect(buildCmsBreadcrumbJsonLd([{ name: "Home", url: "https://buda.im" }])).toBeUndefined();
  });
});

describe("buildCmsPageJsonLd", () => {
  it("returns WebPage + BreadcrumbList + FAQPage for a page that has all three", () => {
    const nodes = buildCmsPageJsonLd(SITE, {
      url: "https://buda.im/gpt-6-astra",
      title: "GPT-6 Astra",
      lang: "en",
      breadcrumbs: [
        { name: "Home", url: "https://buda.im" },
        { name: "GPT-6 Astra", url: "https://buda.im/gpt-6-astra" },
      ],
      bodyHtml: REAL_FAQ_HTML,
    });

    expect(nodes.map((node) => node["@type"])).toEqual(["WebPage", "BreadcrumbList", "FAQPage"]);
  });

  it("returns just the WebPage when the body has no FAQ and there is no trail", () => {
    const nodes = buildCmsPageJsonLd(SITE, {
      url: "https://buda.im/plain",
      title: "Plain",
      lang: "en",
      bodyHtml: "<p>Nothing structured here.</p>",
    });

    expect(nodes.map((node) => node["@type"])).toEqual(["WebPage"]);
  });
});
