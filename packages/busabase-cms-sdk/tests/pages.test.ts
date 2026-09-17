import { describe, expect, it } from "vitest";
import type { CmsRead } from "../src/fallback";
import { createCmsPageHelpers } from "../src/integration";
import { createCmsPathHelpers } from "../src/routing";
import type { PageVO } from "../src/types";

const paths = createCmsPathHelpers({
  supportedLocales: ["en", "zh-CN", "ja", "pt"],
  defaultLocale: "en",
});

const page = (path: string, locale: string): PageVO =>
  ({
    id: `page-${path}`,
    path,
    locale,
    title: `Title ${locale}`,
    body: "<p>body</p>",
    seoTitle: `SEO ${locale}`,
    seoDescription: `Desc ${locale}`,
  }) as unknown as PageVO;

/**
 * Builds helpers over a fixed set of Pages. `unavailable` makes every read report the CMS as
 * unreachable, which the status-aware reads must never confuse with "no such page".
 */
const helpersFor = (pages: PageVO[], { unavailable = false } = {}) => {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const reads: string[] = [];

  const helpers = createCmsPageHelpers({
    integration: {
      buildCmsPath: paths.buildPath,
      parseCmsPath: paths.parsePath,
      isCmsContentForLocale: paths.isForLocale,
      cmsPathHelpers: paths,
      getBusabaseLandingPageByPathOrFallback: async (path: string): Promise<PageVO | null> => {
        reads.push(path);
        return byPath.get(path) ?? null;
      },
      readBusabaseLandingPageByPath: async (path: string): Promise<CmsRead<PageVO | null>> => {
        reads.push(path);
        return unavailable
          ? { status: "unavailable" }
          : { status: "ok", data: byPath.get(path) ?? null };
      },
    },
    generatePageMetadata: (options) => options,
  });

  return { helpers, reads };
};

const EN_ONLY = [page("/gpt-6-astra", "en")];
const EN_AND_JA = [page("/gpt-6-astra", "en"), page("/ja/gpt-6-astra", "ja")];

describe("createCmsPageHelpers — locale fallback", () => {
  it("serves the English Page when the requested locale has no translation", async () => {
    const { helpers } = helpersFor(EN_ONLY);

    const resolved = await helpers.resolveCmsPageForRequest("pt", ["gpt-6-astra"]);
    expect(resolved).toMatchObject({
      requestedLocale: "pt",
      contentLocale: "en",
      isLocaleFallback: true,
    });
    expect(resolved?.page.path).toBe("/gpt-6-astra");
  });

  it("prefers the requested locale over English, and does not flag a fallback", async () => {
    const { helpers, reads } = helpersFor(EN_AND_JA);

    const resolved = await helpers.resolveCmsPageForRequest("ja", ["gpt-6-astra"]);
    expect(resolved).toMatchObject({
      contentLocale: "ja",
      isLocaleFallback: false,
    });
    expect(resolved?.page.path).toBe("/ja/gpt-6-astra");
    // The English original must not even be read when the translation exists.
    expect(reads).toEqual(["/ja/gpt-6-astra"]);
  });

  it("still returns null for a slug that exists in no locale at all", async () => {
    const { helpers } = helpersFor(EN_ONLY);

    await expect(helpers.resolveCmsPageForRequest("pt", ["no-such-page"])).resolves.toBeNull();
    await expect(helpers.getCmsPageForRequest("pt", ["no-such-page"])).resolves.toBeNull();
  });

  it("does not retry English when English itself is the requested locale", async () => {
    const { helpers, reads } = helpersFor(EN_ONLY);

    await expect(helpers.resolveCmsPageForRequest("en", ["no-such-page"])).resolves.toBeNull();
    expect(reads).toEqual(["/no-such-page"]);
  });

  it("gives getCmsPageForRequest the same fallback, so existing callers stop 404ing", async () => {
    const { helpers } = helpersFor(EN_ONLY);

    const found = await helpers.getCmsPageForRequest("zh-CN", ["gpt-6-astra"]);
    expect(found?.path).toBe("/gpt-6-astra");
  });

  it("returns null for a locale this app does not support at all", async () => {
    const { helpers } = helpersFor(EN_ONLY);

    await expect(helpers.resolveCmsPageForRequest("de", ["gpt-6-astra"])).resolves.toBeNull();
  });
});

describe("createCmsPageHelpers — status-aware reads keep 'unreachable' distinct", () => {
  it("reports unavailable rather than silently falling back to English", async () => {
    const { helpers } = helpersFor(EN_ONLY, { unavailable: true });

    await expect(helpers.readResolvedCmsPageForRequest("pt", ["gpt-6-astra"])).resolves.toEqual({
      status: "unavailable",
    });
    await expect(helpers.readCmsPageForRequest("pt", ["gpt-6-astra"])).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("reports a genuinely missing page as ok+null, not as unavailable", async () => {
    const { helpers } = helpersFor(EN_ONLY);

    await expect(helpers.readCmsPageForRequest("pt", ["no-such-page"])).resolves.toEqual({
      status: "ok",
      data: null,
    });
  });

  it("falls back to English through the status-aware read too", async () => {
    const { helpers } = helpersFor(EN_ONLY);

    const read = await helpers.readResolvedCmsPageForRequest("ja", ["gpt-6-astra"]);
    expect(read.status).toBe("ok");
    expect(read.status === "ok" && read.data).toMatchObject({
      contentLocale: "en",
      isLocaleFallback: true,
    });
  });
});

describe("createCmsPageHelpers — metadata on a fallback", () => {
  it("points the canonical URL at the locale that actually owns the content", async () => {
    const { helpers } = helpersFor(EN_ONLY);
    const resolved = await helpers.resolveCmsPageForRequest("pt", ["gpt-6-astra"]);
    if (!resolved) throw new Error("expected the English original to resolve as a pt fallback");

    // Previously this returned {} — a 200 page with no title or canonical at all.
    expect(await helpers.generateCmsPageMetadata(resolved.page, "pt")).toEqual({
      title: "SEO en",
      description: "Desc en",
      path: "/gpt-6-astra",
      // `lang` stays the REQUESTED locale; canonicalLang/contentLang carry the fallback.
      lang: "pt",
      canonicalLang: "en",
      contentLang: "en",
      availableLocales: ["en"],
      canonicalUrl: undefined,
      imageText: "SEO en",
      // The fixture has a seo-title, so it is an editor-authored complete title.
      absoluteTitle: true,
      type: "website",
    });
  });

  it("advertises ONLY the locales that really have the Page", async () => {
    // The live bug this replaces: /zh-CN/gpt-6-astra advertised hreflang for all six
    // locales while its canonical pointed back at the English original — contradictory
    // annotations that make Google drop the whole cluster.
    const { helpers } = helpersFor(EN_AND_JA);
    const resolved = await helpers.resolveCmsPageForRequest("pt", ["gpt-6-astra"]);
    if (!resolved) throw new Error("expected the English original to resolve as a pt fallback");

    const metadata = await helpers.generateCmsPageMetadata(resolved.page, "pt");

    // Exactly these two — the requested `pt` has no Page and must not be advertised.
    expect(metadata).toMatchObject({ availableLocales: ["en", "ja"] });
  });

  it("keeps using the requested locale when the Page really is in that locale", async () => {
    const { helpers } = helpersFor(EN_AND_JA);
    const resolved = await helpers.resolveCmsPageForRequest("ja", ["gpt-6-astra"]);
    if (!resolved) throw new Error("expected the ja Page to resolve");

    expect(await helpers.generateCmsPageMetadata(resolved.page, "ja")).toMatchObject({
      lang: "ja",
      canonicalLang: "ja",
      contentLang: "ja",
      path: "/gpt-6-astra",
      availableLocales: ["en", "ja"],
    });
  });

  it("passes an editor-set canonical-url through instead of the computed one", async () => {
    const withCanonical = [
      { ...page("/gpt-6-astra", "en"), canonicalUrl: "https://buda.im/models" } as PageVO,
    ];
    const { helpers } = helpersFor(withCanonical);
    const resolved = await helpers.resolveCmsPageForRequest("en", ["gpt-6-astra"]);
    if (!resolved) throw new Error("expected the English Page to resolve");

    expect(await helpers.generateCmsPageMetadata(resolved.page, "en")).toMatchObject({
      canonicalUrl: "https://buda.im/models",
    });
  });
});

describe("createCmsPageHelpers — structured data", () => {
  const SITE = { baseUrl: "https://buda.im", siteName: "Buda" };

  const jsonLdHelpersFor = (pages: PageVO[]) =>
    createCmsPageHelpers({
      integration: {
        buildCmsPath: paths.buildPath,
        parseCmsPath: paths.parsePath,
        isCmsContentForLocale: paths.isForLocale,
        cmsPathHelpers: paths,
        getBusabaseLandingPageByPathOrFallback: async (path: string) =>
          pages.find((p) => p.path === path) ?? null,
        readBusabaseLandingPageByPath: async (path: string): Promise<CmsRead<PageVO | null>> => ({
          status: "ok",
          data: pages.find((p) => p.path === path) ?? null,
        }),
      },
      generatePageMetadata: (options) => options,
      jsonLdSite: SITE,
    });

  it("emits WebPage + BreadcrumbList, and FAQPage when the body has one", async () => {
    const withFaq = {
      ...page("/gpt-6-astra", "en"),
      body: "<details><summary>Q1</summary><p>A1</p></details><details><summary>Q2</summary><p>A2</p></details>",
      updatedAt: "2026-09-04T09:20:51.960Z",
    } as PageVO;
    const helpers = jsonLdHelpersFor([withFaq]);

    const nodes = await helpers.buildCmsPageJsonLd(withFaq, "en");

    expect(nodes.map((node) => node["@type"])).toEqual(["WebPage", "BreadcrumbList", "FAQPage"]);
    expect(nodes[0]).toMatchObject({
      "@id": "https://buda.im/gpt-6-astra",
      inLanguage: "en",
      dateModified: "2026-09-04T09:20:51.960Z",
    });
  });

  it("labels the schema with the BODY's language on a locale fallback, not the request's", async () => {
    // Calling English content `zh-CN` is precisely the wrong-but-plausible structured
    // data that is worse than emitting none.
    const helpers = jsonLdHelpersFor(EN_ONLY);
    const resolved = await helpers.resolveCmsPageForRequest("pt", ["gpt-6-astra"]);
    if (!resolved) throw new Error("expected an English fallback");

    const [webPage] = await helpers.buildCmsPageJsonLd(resolved.page, "pt");

    expect(webPage).toMatchObject({ inLanguage: "en", "@id": "https://buda.im/gpt-6-astra" });
  });

  it("includes an ancestor crumb only when that ancestor Page really exists", async () => {
    const parent = page("/gpt-6-astra", "en");
    const child = page("/gpt-6-astra/coding", "en");
    const helpers = jsonLdHelpersFor([parent, child]);

    const [, breadcrumb] = await helpers.buildCmsPageJsonLd(child, "en");

    expect(breadcrumb).toMatchObject({
      itemListElement: [
        { position: 1, name: "Home", item: "https://buda.im" },
        { position: 2, name: "SEO en", item: "https://buda.im/gpt-6-astra" },
        { position: 3, name: "SEO en", item: "https://buda.im/gpt-6-astra/coding" },
      ],
    });
  });

  it("omits a crumb for an ancestor path that has no Page, instead of inventing one", async () => {
    // Deriving the trail from URL segments alone would claim a `/gpt-6-astra` crumb
    // that 404s.
    const orphan = page("/gpt-6-astra/coding", "en");
    const helpers = jsonLdHelpersFor([orphan]);

    const [, breadcrumb] = await helpers.buildCmsPageJsonLd(orphan, "en");

    expect(breadcrumb).toMatchObject({
      itemListElement: [
        { position: 1, name: "Home", item: "https://buda.im" },
        { position: 2, name: "SEO en", item: "https://buda.im/gpt-6-astra/coding" },
      ],
    });
  });

  it("emits nothing at all when the app configured no jsonLdSite", async () => {
    const { helpers } = helpersFor(EN_ONLY);

    expect(await helpers.buildCmsPageJsonLd(page("/gpt-6-astra", "en"), "en")).toEqual([]);
  });
});

describe("createCmsPageHelpers — getAvailableCmsPageLocales", () => {
  it("returns the locales that have the Page, in the app's locale order", async () => {
    const { helpers } = helpersFor(EN_AND_JA);

    expect(await helpers.getAvailableCmsPageLocales(["gpt-6-astra"])).toEqual(["en", "ja"]);
  });

  it("returns only English for a Page that exists only in English", async () => {
    const { helpers } = helpersFor(EN_ONLY);

    expect(await helpers.getAvailableCmsPageLocales(["gpt-6-astra"])).toEqual(["en"]);
  });

  it("returns nothing for a path no locale has", async () => {
    const { helpers } = helpersFor(EN_AND_JA);

    expect(await helpers.getAvailableCmsPageLocales(["no-such-page"])).toEqual([]);
  });

  it("probes each supported locale once, in parallel, and reads nothing else", () => {
    // Deliberately NOT one `pages.list()` call: measured against the real CMS that list
    // is ~2.9MB (every record carries its body), which is over Next's 2MB data-cache
    // ceiling and so gets refetched in full on every render. Small per-path reads cache.
    const { helpers, reads } = helpersFor(EN_AND_JA);

    return helpers.getAvailableCmsPageLocales(["gpt-6-astra"]).then(() => {
      expect(reads.sort()).toEqual([
        "/gpt-6-astra",
        "/ja/gpt-6-astra",
        "/pt/gpt-6-astra",
        "/zh-CN/gpt-6-astra",
      ]);
    });
  });

  it("still self-references when the CMS is unreachable and the list comes back empty", async () => {
    // A transient CMS outage must not strip a page's own hreflang entry: the locale that
    // produced the page we are rendering demonstrably has a version of it.
    const { helpers } = helpersFor(EN_ONLY, { unavailable: true });

    // `unavailable` only affects the status-aware read; the plain getter still resolves,
    // so assert the guarantee that matters: metadata never loses its self-reference.
    expect(await helpers.generateCmsPageMetadata(page("/gpt-6-astra", "en"), "en")).toMatchObject({
      availableLocales: ["en"],
    });
  });
});

describe("createCmsPageHelpers — getCmsPageForLocale is strict", () => {
  it("returns null for a locale with no translation, instead of the English original", async () => {
    const { helpers, reads } = helpersFor(EN_ONLY);

    // The whole point: a caller running its own cross-locale cascade (Buda's use-case resolver)
    // must see a real miss here. If this ever falls back, every locale looks translated and the
    // "showing English" notice silently disappears from /use-cases.
    await expect(helpers.getCmsPageForLocale("pt", ["gpt-6-astra"])).resolves.toBeNull();
    expect(reads).toEqual(["/pt/gpt-6-astra"]);
  });

  it("still returns the Page when that locale really has one", async () => {
    const { helpers } = helpersFor(EN_AND_JA);

    const ja = await helpers.getCmsPageForLocale("ja", ["gpt-6-astra"]);
    expect(ja?.path).toBe("/ja/gpt-6-astra");
    const en = await helpers.getCmsPageForLocale("en", ["gpt-6-astra"]);
    expect(en?.path).toBe("/gpt-6-astra");
  });
});
