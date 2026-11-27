import { loader } from "fumadocs-core/source";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreLlmsImageSources } from "./llms-images";
import { createLlmsRoutes, getLlmsDocText as getDocText } from "./llms-routes";

const getLlmsDocText = (page: Parameters<typeof getDocText>[0], titleFallback?: string) =>
  getDocText(page, titleFallback, true);

const BASE_URL = "https://site.test";

const mdxPage = (path: string, title: string, description: string, body: string) => ({
  type: "page" as const,
  path,
  data: { title, description, getText: async (type: "raw" | "processed") => `${type}: ${body}` },
});

const docsSource = loader({
  baseUrl: "/docs",
  source: {
    files: [
      mdxPage("index.mdx", "Welcome", "Start here.", "Hello"),
      mdxPage("guides/setup.mdx", "Setup", "", "Install it"),
      { type: "meta" as const, path: "guides/meta.json", data: { title: "Guides" } },
    ],
  },
});

const indexContent = {
  posts: [
    {
      canonicalPath: "/blog/launch",
      segments: ["blog", "launch"],
      title: "Launch",
      description: "We shipped.",
      publishedAt: "2026-09-30",
    },
    {
      canonicalPath: "/blog/_draft",
      segments: ["blog", "_draft"],
      title: "Draft",
      publishedAt: "2026-10-01",
    },
  ],
};

const DOCS_INDEX = [
  "- [Welcome](/docs): Start here.",
  "- Guides",
  "  - [Setup](/docs/guides/setup)",
].join("\n");

const BLOG = "## Blog\n\n- [Launch](https://site.test/blog/launch): We shipped.";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLlmsRoutes /llms.txt", () => {
  it("serves intro, the generated docs index, then the content index", async () => {
    const routes = createLlmsRoutes({
      baseUrl: `${BASE_URL}/`,
      intro: (baseUrl) => `# Site\n\n- [Docs](${baseUrl}/docs)`,
      loadIndex: () => indexContent,
      docsSource,
    });
    const response = await routes.llmsTxt();

    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe(
      `# Site\n\n- [Docs](https://site.test/docs)\n\n## Documentation\n\n${DOCS_INDEX}\n\n${BLOG}`,
    );
  });

  it("keeps a static intro byte for byte, trailing newline included", async () => {
    const routes = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: "# Site\n",
      docsSource,
      docsHeading: "Docs",
    });
    expect(await (await routes.llmsTxt()).text()).toBe(`# Site\n\n## Docs\n\n${DOCS_INDEX}`);
  });

  it("emits no docs section for a docs source without pages, in any locale", async () => {
    const empty = loader({
      baseUrl: "/docs",
      source: { files: [] },
      i18n: { languages: ["en", "ja"], defaultLanguage: "en" },
    });
    const routes = createLlmsRoutes({ baseUrl: BASE_URL, intro: "# Site", docsSource: empty });
    expect(await (await routes.llmsTxt()).text()).toBe("# Site");
    expect(await (await routes.llmsFullTxt()).text()).toBe("");
  });

  it("lists every locale under one heading, like fumadocs' own index", async () => {
    const localized = loader({
      baseUrl: "/docs",
      source: {
        files: [
          { ...mdxPage("index.mdx", "Welcome", "", "Hello"), path: "index.mdx" },
          { ...mdxPage("index.zh.mdx", "欢迎", "", "你好"), path: "index.zh.mdx" },
        ],
      },
      i18n: { languages: ["en", "zh"], defaultLanguage: "en", parser: "dot" },
    });
    const routes = createLlmsRoutes({ baseUrl: BASE_URL, intro: "# Site", docsSource: localized });
    expect(await (await routes.llmsTxt()).text()).toBe(
      "# Site\n\n## Documentation\n\n- [Welcome](/en/docs)\n\n### Docs\n\n- [欢迎](/zh/docs)",
    );
  });

  it("serves the intro alone with no docs and nothing to index", async () => {
    const routes = createLlmsRoutes({ baseUrl: BASE_URL, intro: "# Site", loadIndex: () => ({}) });
    expect(await (await routes.llmsTxt()).text()).toBe("# Site");
  });

  it("leaves out the docs index, not the file, when generating it throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = {
      ...docsSource,
      getPageTree: () => {
        throw new Error("boom");
      },
    };
    const routes = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: "# Site",
      docsSource: broken,
      loadIndex: () => indexContent,
    });
    expect(await (await routes.llmsTxt()).text()).toBe(`# Site\n\n${BLOG}`);
  });
});

describe("createLlmsRoutes /llms-full.txt", () => {
  it("serves the full intro, every docs page's processed text, then the content index", async () => {
    const routes = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: "# Site",
      fullIntro: (baseUrl) => `# Site Documentation\n\nVisit ${baseUrl}/docs.`,
      loadIndex: () => indexContent,
      docsSource,
    });
    const response = await routes.llmsFullTxt();

    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe(
      [
        "# Site Documentation\n\nVisit https://site.test/docs.",
        "# Welcome (/docs)\n\nprocessed: Hello",
        "# Setup (/docs/guides/setup)\n\nprocessed: Install it",
        BLOG,
      ].join("\n\n"),
    );
  });

  it("starts with the docs text when there is no full intro", async () => {
    const routes = createLlmsRoutes({ baseUrl: BASE_URL, intro: "# Site", docsSource });
    expect(await (await routes.llmsFullTxt()).text()).toBe(
      "# Welcome (/docs)\n\nprocessed: Hello\n\n# Setup (/docs/guides/setup)\n\nprocessed: Install it",
    );
  });
});

describe("createLlmsRoutes docMarkdown", () => {
  const routes = createLlmsRoutes({ baseUrl: BASE_URL, intro: "# Site", docsSource });

  it("serves a docs page as Markdown, the same text /llms-full.txt carries", async () => {
    const response = await routes.docMarkdown(Promise.resolve({ slug: ["guides", "setup"] }));
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe("# Setup (/docs/guides/setup)\n\nprocessed: Install it");
  });

  it("serves the docs root for an empty slug", async () => {
    const response = await routes.docMarkdown(Promise.resolve({}));
    expect(await response.text()).toBe("# Welcome (/docs)\n\nprocessed: Hello");
  });

  it("is a 404 for a page that does not exist", async () => {
    await expect(routes.docMarkdown(Promise.resolve({ slug: ["nope"] }))).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });
});

describe("getLlmsDocText", () => {
  const token = `fd-llms-image-${"a".repeat(64)}-0`;
  const pageWith = (data: object) => ({
    type: "page" as const,
    slugs: ["image"],
    url: "/docs/image",
    path: "image.mdx",
    absolutePath: undefined,
    data: { title: "Image", ...data },
  });

  it("restores resolved image assets from ordinary Fumadocs exports without rewriting code examples", async () => {
    const text = `<img alt="Diagram" src="${token}" title="Original title" />\n\n\`<img src="__img0" />\`\n\n\`\`\`html\n<img src="__img0" />\n\`\`\``;
    const page = pageWith({
      getText: async () => text,
      _exports: { _llmsImageSources: { [token]: "/_next/static/media/diagram.hash.svg" } },
    });
    const result = await getLlmsDocText(page);
    expect(result).toContain(
      '<img alt="Diagram" src="/_next/static/media/diagram.hash.svg" title="Original title" />',
    );
    expect(result).toContain('`<img src="__img0" />`');
    expect(result).toContain('```html\n<img src="__img0" />\n```');
  });

  it("reads async collection exports through load after processed text has loaded", async () => {
    const load = vi.fn(async () => ({
      body: () => null,
      toc: [],
      _exports: { _llmsImageSources: { [token]: "/assets/docs/relative.webp" } },
    }));
    const page = pageWith({ getText: async () => `<img src="${token}" alt="Original" />`, load });
    expect(await getLlmsDocText(page)).toContain('src="/assets/docs/relative.webp"');
    expect(load).toHaveBeenCalledOnce();
    const noTokens = pageWith({ getText: async () => "`__img0`", load });
    await getLlmsDocText(noTokens);
    expect(load).toHaveBeenCalledOnce();
  });

  it("validates real images with no token map while preserving code, text and valid URLs byte for byte", async () => {
    const examples = [
      '`<img src="__img0" />`',
      '```html\n<Image src="hero" />\n```',
      '    <img src="hero.src" />',
      "Ordinary __img0 and hero.src text.",
      `<pre><code>&lt;img src="hero" /&gt;</code></pre>`,
      '<svg><image href="/assets/vector.svg" /></svg>',
      "> ![Nested][diagram]\n>\n> [diagram]: /images/diagram.svg",
      `<img src="/images/hero.png" alt="Original" title="Title" />`,
      `<Image src="./hero.png" />`,
      `<img src="../media/hero.webp" />`,
      '![Relative](hero.svg "Original")',
      '![Nested relative](images/hero.svg "Original")',
      "![Remote](https://cdn.example/hero.png)",
      '<img src="https://cdn.example/hero.png?size=2&amp;v=1" />',
    ].join("\n\n");
    expect(await getLlmsDocText(pageWith({ getText: async () => examples }))).toBe(
      `# Image (/docs/image)\n\n${examples}`,
    );
    for (const text of [
      '<img src="__img0" />',
      '<Image src="hero" />',
      '<img src="hero.src" />',
      '<Image src="enabled ? hero : fallback" />',
      "![Broken](__img0)",
      '<img src="data:image/png;base64,AAAA" />',
    ]) {
      await expect(getLlmsDocText(pageWith({ getText: async () => text }))).rejects.toMatchObject({
        phase: "image-validation",
        pageUrl: "/docs/image",
        unresolvedImageCount: 1,
      });
    }
  });

  it("uses the first Markdown reference definition just as the rendered document does", async () => {
    const brokenFirst = "![Diagram][image]\n\n[image]: hero\n[image]: /assets/valid.svg";
    await expect(
      getLlmsDocText(pageWith({ getText: async () => brokenFirst })),
    ).rejects.toMatchObject({ phase: "image-validation", unresolvedImageCount: 1 });
    const validFirst = "![Diagram][image]\n\n[image]: /assets/valid.svg\n[image]: hero";
    expect(await getLlmsDocText(pageWith({ getText: async () => validFirst }))).toContain(
      validFirst,
    );
  });

  it("does not restore or load token-shaped code samples or ordinary text", async () => {
    const code = `\`${token}\`\n\n\`\`\`html\n<img src="${token}" />\n\`\`\`\n\n    <img src="${token}" />\n\n${token}`;
    const load = vi.fn(async () => {
      throw new Error("must not load examples");
    });
    expect(await getLlmsDocText(pageWith({ getText: async () => code, load }))).toContain(code);
    expect(load).not.toHaveBeenCalled();
    const mixed = `<img src="${token}" />\n\n${code}`;
    const restored = restoreLlmsImageSources(mixed, { [token]: "/assets/image.png" });
    expect(restored).toBe(`<img src="/assets/image.png" />\n\n${code}`);
  });

  it("does not interpret unknown maps, arbitrary identifiers or source filesystem addresses", async () => {
    for (const invalid of [
      undefined,
      null,
      [],
      "map",
      { [token]: "/Users/person/secret.png" },
      { [token]: "file:///project/private.png" },
      { [token]: "../local/image.svg" },
      { [token]: "//private.example/image.svg" },
      { [token]: "/assets/%2e%2e/Users/person/private.png" },
      { [token]: "javascript:alert(1)" },
      { [token]: "https://user:secret@cdn.example/img.png" },
      { [token]: { src: "/_next/static/media/valid.png" } },
      { __img0: "https://cdn.example/image.png" },
    ]) {
      const processed = `<img src="${token}" />\n\n<img src="__img0" />`;
      expect(restoreLlmsImageSources(processed, invalid)).toBe(processed);
      await expect(
        getLlmsDocText(
          pageWith({ getText: async () => processed, _exports: { _llmsImageSources: invalid } }),
        ),
      ).rejects.toThrow("Unresolved compiled documentation image");
    }
    const remote = pageWith({
      getText: async () => `<img src="${token}" />`,
      _exports: { _llmsImageSources: { [token]: "https://cdn.example/diagram.png" } },
    });
    expect(await getLlmsDocText(remote)).toContain('src="https://cdn.example/diagram.png"');
    const unknown = `fd-llms-image-${"b".repeat(64)}-0`;
    const knownAndUnknown = pageWith({
      getText: async () => `<img src="${token}" />\n\n<img src="${unknown}" />`,
      _exports: { _llmsImageSources: { [token]: "/assets/docs/known.png" } },
    });
    expect(
      restoreLlmsImageSources(`<img src="${token}" />\n\n<img src="${unknown}" />`, {
        [token]: "/assets/docs/known.png",
      }),
    ).toContain(`src="${unknown}"`);
    await expect(getLlmsDocText(knownAndUnknown)).rejects.toThrow(
      "Unresolved compiled documentation image",
    );
  });

  it("does not carry filesystem URL identities into safe diagnostic metadata", async () => {
    const page = pageWith({ getText: async () => '<img src="unresolvedVariable" />' });
    page.url = "file:///private/local/docs/page.mdx?token=private-query";
    await expect(getLlmsDocText(page)).rejects.toMatchObject({
      phase: "image-validation",
      pageUrl: undefined,
      unresolvedImageCount: 1,
    });
  });

  it("uses supplied API text with the title fallback when a virtual page has no title", async () => {
    const page = {
      type: "openapi",
      slugs: ["api"],
      url: "/docs/api",
      path: "api",
      absolutePath: undefined,
      data: { title: undefined, getText: async () => "## GET /records\n\nThe public contract." },
    };
    await expect(getLlmsDocText(page, "API Documentation")).resolves.toBe(
      "# API Documentation (/docs/api)\n\n## GET /records\n\nThe public contract.",
    );
  });

  it("renders virtual OpenAPI pages as title and description, with a title fallback", async () => {
    const openapiPage = {
      type: "openapi",
      slugs: ["api"],
      url: "/docs/api",
      path: "api",
      absolutePath: undefined,
      data: { description: "Every endpoint." },
    };
    await expect(getLlmsDocText(openapiPage, "Site Documentation")).resolves.toBe(
      "# Site Documentation (/docs/api)\n\nEvery endpoint.",
    );
  });
});

describe("opt-in strict Docs generation", () => {
  it("preserves legacy exports for apps which have not enabled strict Docs", async () => {
    const source = loader({
      baseUrl: "/docs",
      source: { files: [mdxPage("legacy.mdx", "Legacy", "", '<img src="__img0" />')] },
    });
    const legacy = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: "# Legacy app",
      docsSource: source,
    });
    const page = source.getPage(["legacy"]);
    if (!page) throw new Error("Missing legacy fixture page");
    expect(await getDocText(page)).toContain('<img src="__img0" />');
    const full = await legacy.llmsFullTxt();
    expect(full.status).toBe(200);
    expect(await full.text()).toContain('<img src="__img0" />');
    const single = await legacy.docMarkdown(Promise.resolve({ slug: ["legacy"] }));
    expect(single.status).toBe(200);
    expect(await single.text()).toContain('<img src="__img0" />');
    const strict = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: "# Strict app",
      docsSource: source,
      docsErrorMode: "fail",
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await strict.llmsFullTxt()).status).toBe(503);
    const strictSingle = await strict.docMarkdown(Promise.resolve({ slug: ["legacy"] }));
    expect(strictSingle.status).toBe(503);
  });

  const unavailable = async (response: Response) => {
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.text()).toBe("Documentation temporarily unavailable");
  };

  it("returns an uncached retryable docs index failure without private details or a partial successful file", async () => {
    const error = new Error("private-index-detail"),
      warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = {
      ...docsSource,
      getPageTree: () => {
        throw error;
      },
    };
    const routes = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: "# Site",
      docsSource: broken,
      docsErrorMode: "fail",
      loadIndex: () => indexContent,
    });
    await unavailable(await routes.llmsTxt());
    expect(warn).toHaveBeenCalledExactlyOnceWith("[llms.txt] Documentation generation failed", {
      phase: "index",
      pageUrl: undefined,
      unresolvedImageCount: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-index-detail");
  });

  it("returns retryable processed-doc and lazy-asset-map failures rather than omitting all docs", async () => {
    for (const failAt of ["text", "assets"]) {
      const error = new Error(`private-${failAt}-detail`),
        warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const broken = loader({
        baseUrl: "/docs",
        source: {
          files: [
            {
              type: "page",
              path: "index.mdx",
              data: {
                title: "Broken",
                getText: async () => {
                  if (failAt === "text") throw error;
                  return `<img src="fd-llms-image-${"a".repeat(64)}-0" />`;
                },
                load: async () => {
                  throw error;
                },
              },
            },
          ],
        },
      });
      const strict = createLlmsRoutes({
        baseUrl: BASE_URL,
        intro: "# Site",
        docsSource: broken,
        docsErrorMode: "fail",
      });
      await unavailable(await strict.llmsFullTxt());
      await unavailable(await strict.docMarkdown(Promise.resolve({})));
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith("[llms.txt] Documentation generation failed", {
        phase: failAt === "text" ? "processed-text" : "image-sources",
        pageUrl: "/docs",
        unresolvedImageCount: undefined,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(`private-${failAt}-detail`);
      warn.mockRestore();
      const legacy = createLlmsRoutes({
        baseUrl: BASE_URL,
        intro: "# Site",
        fullIntro: "# Full",
        docsSource: broken,
      });
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(await (await legacy.llmsFullTxt()).text()).toBe("# Full");
      vi.restoreAllMocks();
    }
  });

  it("logs a safe page identity and unresolved count, rejects the whole file, and recovers on retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let repaired = false;
    const source = loader({
      baseUrl: "/docs",
      source: {
        files: [
          mdxPage("good.mdx", "Good", "", "Good page must not appear in failed output"),
          {
            type: "page",
            path: "broken.mdx",
            data: {
              title: "Broken",
              getText: async () =>
                repaired
                  ? '<img src="/assets/fixed.png" />'
                  : '<Image src="hero" />\n\n<img src="__img0" />',
            },
          },
        ],
      },
    });
    const page = source.getPage(["broken"]);
    if (!page) throw new Error("Missing fixture page");
    page.url =
      "https://user:credential@docs.example/docs/broken?token=query-secret#private-fragment";
    const routes = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: "# Site",
      docsSource: source,
      docsErrorMode: "fail",
    });
    await expect(routes.docText(page)).rejects.toMatchObject({
      phase: "image-validation",
      pageUrl: "/docs/broken",
      unresolvedImageCount: 2,
    });
    await unavailable(await routes.llmsFullTxt());
    expect(warn).toHaveBeenCalledExactlyOnceWith("[llms.txt] Documentation generation failed", {
      phase: "image-validation",
      pageUrl: "/docs/broken",
      unresolvedImageCount: 2,
    });
    const logs = JSON.stringify(warn.mock.calls);
    for (const secret of ["credential", "query-secret", "private-fragment", "hero", "__img0"])
      expect(logs).not.toContain(secret);
    repaired = true;
    const response = await routes.llmsFullTxt();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('src="/assets/fixed.png"');
    expect(warn).toHaveBeenCalledOnce();
  });

  it("continues accepting a genuinely empty docs source under strict mode", async () => {
    const empty = loader({ baseUrl: "/docs", source: { files: [] } });
    const strict = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: "# Site",
      fullIntro: "# Full",
      docsSource: empty,
      docsErrorMode: "fail",
    });
    expect(await (await strict.llmsTxt()).text()).toBe("# Site");
    expect(await (await strict.llmsFullTxt()).text()).toBe("# Full");
  });

  it("keeps a genuinely unknown Markdown page as a 404 and a failed lookup as an uncached 503", async () => {
    const strict = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: "# Site",
      docsSource,
      docsErrorMode: "fail",
    });
    await expect(strict.docMarkdown(Promise.resolve({ slug: ["unknown"] }))).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
    const broken = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: "# Site",
      docsSource: {
        ...docsSource,
        getPage: () => {
          throw new Error("private-lookup-detail");
        },
      },
      docsErrorMode: "fail",
    });
    await unavailable(await broken.docMarkdown(Promise.resolve({})));
  });

  it("does not relabel brand-text program errors as documentation outages", async () => {
    const error = new Error("private-program-error");
    const brokenIntro = () => {
      throw error;
    };
    const strict = createLlmsRoutes({
      baseUrl: BASE_URL,
      intro: brokenIntro,
      fullIntro: brokenIntro,
      docsSource,
      docsErrorMode: "fail",
    });
    await expect(strict.llmsTxt()).rejects.toBe(error);
    await expect(strict.llmsFullTxt()).rejects.toBe(error);
  });
});

describe("untranslated locales", () => {
  // en has two pages, zh translated only the index, ja translated nothing: fumadocs serves zh's
  // setup page and all of ja from the English files (its fallbackLanguage).
  const partial = loader({
    baseUrl: "/docs",
    source: {
      files: [
        mdxPage("index.mdx", "Welcome", "", "Hello"),
        mdxPage("setup.mdx", "Setup", "", "Install it"),
        mdxPage("index.zh.mdx", "欢迎", "", "你好"),
      ],
    },
    i18n: { languages: ["en", "zh", "ja"], defaultLanguage: "en", parser: "dot" },
  });
  const routes = createLlmsRoutes({ baseUrl: BASE_URL, intro: "# Site", docsSource: partial });

  it("lists only real translations in the docs index and skips a locale with none", async () => {
    const text = await (await routes.llmsTxt()).text();
    expect(text).toBe(
      [
        "# Site",
        "",
        "## Documentation",
        "",
        "- [Welcome](/en/docs)",
        "- [Setup](/en/docs/setup)",
        "",
        "### Docs",
        "",
        "- [欢迎](/zh/docs)",
      ].join("\n"),
    );
    expect(text.match(/^# /gm)).toHaveLength(1);
    expect(text).not.toContain("/ja/");
  });

  it("includes each English page once in the full text, plus real translations", async () => {
    const text = await (await routes.llmsFullTxt()).text();
    expect(text.match(/^# /gm)).toHaveLength(3);
    expect(text).toContain("# 欢迎 (/zh/docs)");
    expect(text).not.toContain("/zh/docs/setup");
    expect(text).not.toContain("/ja/");
  });
});
