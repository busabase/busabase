import { loader } from "fumadocs-core/source";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmsRoutes, getLlmsDocText } from "./llms-routes";

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
