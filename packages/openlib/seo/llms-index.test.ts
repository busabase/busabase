import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendLlmsIndex,
  buildLlmsIndexSections,
  buildLlmsIndexText,
  type LlmsIndexEntry,
  mergeLlmsIndexEntries,
  renderLlmsIndexSections,
  toLocalLlmsIndexEntries,
  withLlmsIndex,
} from "./llms-index";

const BASE_URL = "https://site.test";
const options = { baseUrl: BASE_URL };

const page = (
  path: string,
  title: string,
  extra: Partial<LlmsIndexEntry> = {},
): LlmsIndexEntry => ({
  canonicalPath: path,
  segments: path.split("/").filter(Boolean),
  title,
  description: `${title} description`,
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...extra,
});

const post = (slug: string, title: string, publishedAt: string | Date | null, extra = {}) =>
  page(`/blog/${slug}`, title, { publishedAt, description: title, ...extra });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildLlmsIndexSections", () => {
  it("groups Pages by URL family and lists the newest Posts first", () => {
    const sections = buildLlmsIndexSections(
      {
        posts: [
          post("older", "Older post", "2026-09-03"),
          post("newest", "Newest post", "2026-09-30"),
          post("middle", "Middle post", "2026-09-21"),
        ],
        pages: [
          page("/compare/busabase-vs-sanity", "Busabase vs Sanity"),
          page("/compare", "Compare Busabase"),
          page("/compare/busabase-vs-notion", "Busabase vs Notion"),
          page("/system-of-record-for-ai-agents", "System of Record for AI Agents"),
          page("/solutions/ai-operations", "AI Operations Workspace"),
          page("/use-cases/sales", "Sales"),
          page("/solutions", "Solutions"),
          page("/knowledge-base-for-cursor", "Knowledge Base for Cursor"),
        ],
      },
      options,
    );

    expect(sections.map((section) => section.heading)).toEqual([
      "Comparisons",
      "Guides",
      "Solutions",
      "Blog",
      "Optional",
    ]);
    // Hub first, then its pages in path order.
    expect(sections[0].links.map((link) => link.url)).toEqual([
      `${BASE_URL}/compare`,
      `${BASE_URL}/compare/busabase-vs-notion`,
      `${BASE_URL}/compare/busabase-vs-sanity`,
    ]);
    expect(sections[2].links.map((link) => link.url)).toEqual([
      `${BASE_URL}/solutions`,
      `${BASE_URL}/solutions/ai-operations`,
      `${BASE_URL}/use-cases/sales`,
    ]);
    expect(sections[3].links.map((link) => link.title)).toEqual([
      "Newest post",
      "Middle post",
      "Older post",
    ]);
    expect(sections[4]).toMatchObject({
      titlesOnly: true,
      links: [{ url: `${BASE_URL}/knowledge-base-for-cursor` }],
    });
  });

  it("caps the Blog section and ignores Posts outside /blog and the /blog index itself", () => {
    const posts = Array.from({ length: 25 }, (_, index) =>
      post(
        `post-${String(index).padStart(2, "0")}`,
        `Post ${index}`,
        `2026-09-${10 + (index % 20)}`,
      ),
    );
    const sections = buildLlmsIndexSections(
      { posts: [...posts, page("/guides/not-a-post", "Not a post"), page("/blog", "Blog index")] },
      { ...options, blogPostLimit: 20 },
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("Blog");
    expect(sections[0].links).toHaveLength(20);
    expect(sections[0].links.some((link) => !/\/blog\/post-\d\d$/.test(link.url))).toBe(false);
  });

  it("falls back to updatedAt when a Post has no publishedAt, and accepts Date values", () => {
    const sections = buildLlmsIndexSections(
      {
        posts: [
          post("dated", "Dated", new Date("2026-09-10T00:00:00.000Z")),
          post("undated", "Undated", null, { updatedAt: "2026-09-20T00:00:00.000Z" }),
          post("nothing", "Nothing", null, { updatedAt: null }),
        ],
      },
      options,
    );
    expect(sections[0].links.map((link) => link.title)).toEqual(["Undated", "Dated", "Nothing"]);
  });

  it("skips untitled entries, repeated URLs and Pages under /blog", () => {
    const sections = buildLlmsIndexSections(
      {
        pages: [
          page("/guide", "Guide"),
          page("/guide", "Guide again"),
          page("/untitled", " \n "),
          page("/blog/stray-page", "Stray"),
        ],
      },
      options,
    );
    expect(sections).toEqual([
      {
        heading: "Guides",
        links: [{ title: "Guide", url: `${BASE_URL}/guide`, description: "Guide description" }],
      },
    ]);
  });

  it("returns no sections when there is nothing", () => {
    expect(buildLlmsIndexSections({}, options)).toEqual([]);
    expect(buildLlmsIndexSections({ posts: [], pages: [] }, options)).toEqual([]);
  });
});

describe("renderLlmsIndexSections", () => {
  it("renders llms.txt list items, titles only under Optional", () => {
    const text = renderLlmsIndexSections([
      {
        heading: "Comparisons",
        links: [
          {
            title: "Busabase vs [Notion]",
            url: `${BASE_URL}/compare/busabase-vs-notion`,
            description: "Line one\nline two",
          },
          { title: "No description", url: `${BASE_URL}/compare/x`, description: null },
        ],
      },
      {
        heading: "Optional",
        titlesOnly: true,
        links: [{ title: "KB for Cursor", url: `${BASE_URL}/kb`, description: "hidden" }],
      },
    ]);

    expect(text).toBe(
      [
        "## Comparisons",
        "",
        `- [Busabase vs \\[Notion\\]](${BASE_URL}/compare/busabase-vs-notion): Line one\nline two`,
        `- [No description](${BASE_URL}/compare/x)`,
        "",
        "## Optional",
        "",
        `- [KB for Cursor](${BASE_URL}/kb)`,
      ].join("\n"),
    );
  });

  it("collapses description whitespace when built from entries", () => {
    const sections = buildLlmsIndexSections(
      { pages: [page("/compare/a", "A", { description: "  Line one\n\nline two  " })] },
      options,
    );
    expect(renderLlmsIndexSections(sections)).toContain(
      `(${BASE_URL}/compare/a): Line one line two`,
    );
  });
});

describe("appendLlmsIndex", () => {
  it("keeps the static text byte-identical and appends after a blank line", () => {
    expect(appendLlmsIndex("# Site\n\nStatic.", "## Blog\n\n- [A](u)")).toBe(
      "# Site\n\nStatic.\n\n## Blog\n\n- [A](u)",
    );
  });

  it("does not stack blank lines after a static text that ends in a newline", () => {
    expect(appendLlmsIndex("# Site\n", "## Blog")).toBe("# Site\n\n## Blog");
    expect(appendLlmsIndex("# Site\n\n", "## Blog")).toBe("# Site\n\n## Blog");
  });

  it("returns the static text alone when nothing was generated", () => {
    expect(appendLlmsIndex("# Site\n\nStatic.", "")).toBe("# Site\n\nStatic.");
    expect(buildLlmsIndexText("# Site", {}, options)).toBe("# Site");
  });
});

describe("withLlmsIndex", () => {
  it("appends the index built from the loaded content", async () => {
    await expect(
      withLlmsIndex("# Site", async () => ({ posts: [post("a", "A", "2026-09-01")] }), options),
    ).resolves.toBe(`# Site\n\n## Blog\n\n- [A](${BASE_URL}/blog/a): A`);
  });

  it("serves the static text alone when loading throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      withLlmsIndex(
        "# Site",
        async () => {
          throw new Error("offline");
        },
        options,
      ),
    ).resolves.toBe("# Site");
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("toLocalLlmsIndexEntries + mergeLlmsIndexEntries", () => {
  it("maps fumadocs pages and lets the first source claim a path", () => {
    const local = toLocalLlmsIndexEntries([
      {
        url: "/blog/hello/",
        data: { title: "Hello (MDX)", description: "Local", date: new Date("2026-02-02") },
      },
      { url: "/blog/only-local", data: { title: "Only local" } },
    ]);
    expect(local[0]).toEqual({
      canonicalPath: "/blog/hello",
      segments: ["blog", "hello"],
      title: "Hello (MDX)",
      description: "Local",
      publishedAt: new Date("2026-02-02"),
      updatedAt: null,
    });

    const merged = mergeLlmsIndexEntries([post("hello", "Hello (CMS)", "2026-09-01")], local);
    expect(merged.map((entry) => entry.title)).toEqual(["Hello (CMS)", "Only local"]);
  });
});
