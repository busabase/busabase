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
    expect(helpers.generateCmsPageMetadata(resolved.page, "pt")).toEqual({
      title: "SEO en",
      description: "Desc en",
      path: "/gpt-6-astra",
      lang: "en",
      type: "website",
    });
  });

  it("keeps using the requested locale when the Page really is in that locale", async () => {
    const { helpers } = helpersFor(EN_AND_JA);
    const resolved = await helpers.resolveCmsPageForRequest("ja", ["gpt-6-astra"]);
    if (!resolved) throw new Error("expected the ja Page to resolve");

    expect(helpers.generateCmsPageMetadata(resolved.page, "ja")).toMatchObject({
      lang: "ja",
      path: "/gpt-6-astra",
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
