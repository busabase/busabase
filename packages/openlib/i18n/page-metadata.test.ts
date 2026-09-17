import { describe, expect, it } from "vitest";
import { createPageMetadataHelpers } from "./page-metadata";

const LOCALES = ["en", "zh-CN", "zh-TW", "ja"] as const;

const helpers = createPageMetadataHelpers({
  baseUrl: "https://example.com",
  defaultLocale: "en",
  supportedLocales: LOCALES,
  defaultImageUrl: "https://example.com/opengraph-image",
  siteName: "Example",
  twitterSite: "@example",
  twitterCreator: "@example",
  openGraphLocales: { en: "en_US", "zh-CN": "zh_CN", "zh-TW": "zh_TW", ja: "ja_JP" },
  buildImageTextUrl: (text) => `https://example.com/og?text=${encodeURIComponent(text)}`,
});

const { generatePageMetadata, getPageAlternates } = helpers;

describe("hreflang describes reality", () => {
  it("lists every supported locale when the caller does not narrow the set", () => {
    const { alternates } = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/pricing",
      lang: "en",
    });

    expect(Object.keys(alternates.languages).sort()).toEqual([
      "en",
      "ja",
      "x-default",
      "zh-CN",
      "zh-TW",
    ]);
  });

  it("lists ONLY the locales that really have the page when availableLocales is passed", () => {
    // The bug this guards: a CMS page that exists only in English used to advertise
    // hreflang for all six locales while its canonical pointed back at the English
    // original — contradictory annotations that make Google drop the whole cluster.
    const { alternates } = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/gpt-6-astra",
      lang: "zh-CN",
      canonicalLang: "en",
      contentLang: "en",
      availableLocales: ["en"],
    });

    expect(Object.keys(alternates.languages).sort()).toEqual(["en", "x-default"]);
    expect(alternates.languages.en).toBe("https://example.com/gpt-6-astra");
    expect(alternates.languages["zh-CN"]).toBeUndefined();
  });

  it("omits x-default when the default locale is not among the available ones", () => {
    const { alternates } = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/only-japanese",
      lang: "ja",
      availableLocales: ["ja"],
    });

    expect(alternates.languages).toEqual({ ja: "https://example.com/ja/only-japanese" });
    expect(alternates.languages["x-default"]).toBeUndefined();
  });

  it("keeps every hreflang URL on the same path as the canonical", () => {
    const { alternates } = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/guides/setup",
      lang: "ja",
      availableLocales: ["en", "ja"],
    });

    expect(alternates.canonical).toBe("https://example.com/ja/guides/setup");
    expect(alternates.languages).toEqual({
      en: "https://example.com/guides/setup",
      ja: "https://example.com/ja/guides/setup",
      "x-default": "https://example.com/guides/setup",
    });
  });
});

describe("canonicalLang / contentLang on a locale fallback", () => {
  it("points the canonical at the page that exists, not at the requested URL", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/gpt-6-astra",
      lang: "zh-CN",
      canonicalLang: "en",
      contentLang: "en",
      availableLocales: ["en"],
    });

    expect(metadata.alternates.canonical).toBe("https://example.com/gpt-6-astra");
    expect(metadata.openGraph.url).toBe("https://example.com/gpt-6-astra");
  });

  it("labels og:locale with the locale the body really is", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/gpt-6-astra",
      lang: "zh-CN",
      canonicalLang: "en",
      contentLang: "en",
      availableLocales: ["en"],
    });

    expect(metadata.openGraph.locale).toBe("en_US");
    // Only one locale exists, so there is no alternate to advertise.
    expect(metadata.openGraph.alternateLocale).toBeUndefined();
  });

  it("defaults canonicalLang and contentLang to lang on an ordinary page", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/pricing",
      lang: "zh-CN",
    });

    expect(metadata.alternates.canonical).toBe("https://example.com/zh-CN/pricing");
    expect(metadata.openGraph.locale).toBe("zh_CN");
    expect(metadata.openGraph.alternateLocale).toEqual(["en_US", "zh_TW", "ja_JP"]);
  });
});

describe("site identity survives Next's replace-don't-merge metadata rule", () => {
  it("carries og:site_name so a page-level openGraph cannot wipe the root layout's", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/pricing",
      lang: "en",
    });

    expect(metadata.openGraph.siteName).toBe("Example");
  });

  it("carries twitter:site and twitter:creator for the same reason", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/pricing",
      lang: "en",
    });

    expect(metadata.twitter.site).toBe("@example");
    expect(metadata.twitter.creator).toBe("@example");
  });

  it("omits the site identity keys entirely when the app did not configure them", () => {
    const bare = createPageMetadataHelpers({
      baseUrl: "https://bare.example",
      defaultLocale: "en",
      supportedLocales: ["en"],
      defaultImageUrl: "https://bare.example/og.png",
    });
    const metadata = bare.generatePageMetadata({
      title: "T",
      description: "D",
      path: "/",
      lang: "en",
    });

    // Better an absent key than an invented site name.
    expect(metadata.openGraph.siteName).toBeUndefined();
    expect(metadata.twitter.site).toBeUndefined();
  });
});

describe("URL normalization", () => {
  it("strips a trailing slash so /docs/ and /docs cannot both be canonical", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/docs/",
      lang: "zh-TW",
    });

    expect(metadata.alternates.canonical).toBe("https://example.com/zh-TW/docs");
    expect(metadata.alternates.languages.en).toBe("https://example.com/docs");
    expect(metadata.openGraph.url).toBe("https://example.com/zh-TW/docs");
  });

  it("keeps the root page canonical at the bare domain", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/",
      lang: "en",
    });

    expect(metadata.alternates.canonical).toBe("https://example.com");
    expect(metadata.alternates.languages["zh-CN"]).toBe("https://example.com/zh-CN");
  });

  it("accepts a path with no leading slash", () => {
    expect(getPageAlternates("en", "pricing").url).toBe("https://example.com/pricing");
  });
});

describe("images and optional fields", () => {
  it("uses the default OG image when the page has none", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/x",
      lang: "en",
    });

    expect(metadata.openGraph.images[0].url).toBe("https://example.com/opengraph-image");
    expect(metadata.twitter.images[0]).toBe("https://example.com/opengraph-image");
  });

  it("renders a page-specific OG image from imageText", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/x",
      lang: "en",
      imageText: "GPT-6 Astra",
    });

    expect(metadata.openGraph.images[0].url).toBe("https://example.com/og?text=GPT-6%20Astra");
  });

  it("prefers an explicit imageUrl over imageText", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/x",
      lang: "en",
      imageUrl: "https://cdn.example/cover.png",
      imageText: "ignored",
    });

    expect(metadata.openGraph.images[0].url).toBe("https://cdn.example/cover.png");
  });

  it("ignores imageText when the app configured no template for it", () => {
    const bare = createPageMetadataHelpers({
      baseUrl: "https://bare.example",
      defaultLocale: "en",
      supportedLocales: ["en"],
      defaultImageUrl: "https://bare.example/og.png",
    });
    const metadata = bare.generatePageMetadata({
      title: "T",
      description: "D",
      path: "/x",
      lang: "en",
      imageText: "no template",
    });

    expect(metadata.openGraph.images[0].url).toBe("https://bare.example/og.png");
  });

  it("omits keywords and modifiedTime unless the page supplies them", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/x",
      lang: "en",
    });

    expect(metadata.keywords).toBeUndefined();
    expect(metadata.openGraph.modifiedTime).toBeUndefined();
  });

  it("passes through page-specific keywords", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/x",
      lang: "en",
      keywords: ["gpt-6 astra", "agent workflow"],
    });

    expect(metadata.keywords).toEqual(["gpt-6 astra", "agent workflow"]);
  });

  it("emits modifiedTime on an article", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/blog/x",
      lang: "en",
      type: "article",
      modifiedTime: "2026-09-04T09:20:51.960Z",
    });

    expect(metadata.openGraph.modifiedTime).toBe("2026-09-04T09:20:51.960Z");
  });

  it("drops modifiedTime on a website — og:modified_time is an article-only property", () => {
    // Next's own Metadata type rejects it on a `website`, so emitting it here would
    // break typecheck in every app that assigns this result to Metadata.
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/x",
      lang: "en",
      modifiedTime: "2026-09-04T09:20:51.960Z",
    });

    expect(metadata.openGraph.modifiedTime).toBeUndefined();
  });
});

describe("absoluteTitle", () => {
  it("passes a bare string through so the root layout's title template still applies", () => {
    const metadata = generatePageMetadata({
      title: "Pricing",
      description: "D",
      path: "/pricing",
      lang: "en",
    });

    expect(metadata.title).toBe("Pricing");
  });

  it("marks an editor-authored title absolute so the brand is not appended twice", () => {
    // Live before this: `Buda AI - GPT-6 Astra for Agent Workflows | Buda`.
    const metadata = generatePageMetadata({
      title: "GPT-6 Astra for Agent Workflows | Buda",
      description: "D",
      path: "/gpt-6-astra",
      lang: "en",
      absoluteTitle: true,
    });

    expect(metadata.title).toEqual({ absolute: "GPT-6 Astra for Agent Workflows | Buda" });
  });

  it("keeps og:title and twitter:title as the bare string, template or not", () => {
    // The template is a <title> concern; leaking `{ absolute }` into a share card
    // would serialize an object where a string belongs.
    const metadata = generatePageMetadata({
      title: "GPT-6 Astra for Agent Workflows | Buda",
      description: "D",
      path: "/gpt-6-astra",
      lang: "en",
      absoluteTitle: true,
    });

    expect(metadata.openGraph.title).toBe("GPT-6 Astra for Agent Workflows | Buda");
    expect(metadata.twitter.title).toBe("GPT-6 Astra for Agent Workflows | Buda");
  });
});

describe("explicit canonical override", () => {
  it("uses the supplied canonical URL verbatim for both canonical and og:url", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/legacy-landing",
      lang: "en",
      canonicalUrl: "https://example.com/pricing",
    });

    expect(metadata.alternates.canonical).toBe("https://example.com/pricing");
    expect(metadata.openGraph.url).toBe("https://example.com/pricing");
  });

  it("suppresses hreflang when consolidating onto a DIFFERENT page", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/legacy-landing",
      lang: "en",
      canonicalUrl: "https://example.com/pricing",
    });

    // Contradictory hreflang is worse than none: Google drops the whole cluster.
    expect(metadata.alternates.languages).toEqual({});
  });

  it("KEEPS hreflang when the canonical is just this page's own URL", () => {
    // Editors routinely fill `canonical-url` with the page's own production URL.
    // Reading that self-canonical as a consolidation silently stripped hreflang from
    // every such page — caught on the live /gpt-6-astra during verification.
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/gpt-6-astra",
      lang: "en",
      availableLocales: ["en", "ja"],
      canonicalUrl: "https://example.com/gpt-6-astra",
    });

    expect(metadata.alternates.canonical).toBe("https://example.com/gpt-6-astra");
    expect(metadata.alternates.languages).toEqual({
      en: "https://example.com/gpt-6-astra",
      ja: "https://example.com/ja/gpt-6-astra",
      "x-default": "https://example.com/gpt-6-astra",
    });
  });

  it("treats a production canonical on a preview host as the same page, not a consolidation", () => {
    // The exact local-verification trap: appConfig.url is localhost, the CMS stores the
    // buda.im URL. Comparing full URLs would drop hreflang on every preview render.
    const preview = createPageMetadataHelpers({
      baseUrl: "http://localhost:3040",
      defaultLocale: "en",
      supportedLocales: ["en", "ja"],
      defaultImageUrl: "http://localhost:3040/og.png",
    });

    const metadata = preview.generatePageMetadata({
      title: "T",
      description: "D",
      path: "/gpt-6-astra",
      lang: "en",
      availableLocales: ["en", "ja"],
      canonicalUrl: "https://buda.im/gpt-6-astra",
    });

    expect(metadata.alternates.languages).toEqual({
      en: "http://localhost:3040/gpt-6-astra",
      ja: "http://localhost:3040/ja/gpt-6-astra",
      "x-default": "http://localhost:3040/gpt-6-astra",
    });
  });

  it("ignores a trailing-slash difference when deciding self vs consolidation", () => {
    const metadata = generatePageMetadata({
      title: "T",
      description: "D",
      path: "/gpt-6-astra",
      lang: "en",
      availableLocales: ["en"],
      canonicalUrl: "https://example.com/gpt-6-astra/",
    });

    expect(metadata.alternates.languages).not.toEqual({});
  });
});

describe("backward compatibility with the pre-upgrade call shape", () => {
  it("still produces canonical + full hreflang for the original four options", () => {
    const metadata = generatePageMetadata({
      title: "Docs",
      description: "Docs description",
      path: "/docs",
      lang: "en",
    });

    expect(metadata.alternates.canonical).toBe("https://example.com/docs");
    expect(metadata.alternates.languages["x-default"]).toBe("https://example.com/docs");
    expect(metadata.openGraph.type).toBe("website");
    expect(metadata.twitter.card).toBe("summary_large_image");
  });

  it("honours an explicit article type", () => {
    const metadata = generatePageMetadata({
      title: "Post",
      description: "D",
      path: "/blog/x",
      lang: "en",
      type: "article",
    });

    expect(metadata.openGraph.type).toBe("article");
  });
});
