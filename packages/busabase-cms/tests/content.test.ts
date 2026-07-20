import { describe, expect, it, vi } from "vitest";
import {
  BusabaseCmsError,
  createBusabaseCms,
  DEFAULT_CATEGORIES_BASE_SLUG,
  DEFAULT_PAGES_BASE_SLUG,
  DEFAULT_POSTS_BASE_SLUG,
  DEFAULT_TAGS_BASE_SLUG,
  mapPublishedPostRecord,
} from "../src/index";
import type { BusabaseCmsRecord, BusabaseCmsSource } from "../src/source";

const attachment = {
  id: "att-cover",
  attachmentId: "attachment-cover",
  assetId: "asset-cover",
  url: "https://cdn.example/cover.png",
  fileName: "cover.png",
  mimeType: "image/png",
  size: 42,
};

const postFields = {
  path: "/blog/sdk-test",
  title: "SDK test",
  slug: "sdk-test",
  locale: "en",
  status: "published",
  description: "Typed canonical content",
  body: "# SDK test",
  "cover-image": [attachment],
  attachments: [attachment],
  author: "Busabase",
  categories: "category-1",
  tags: ["tag-1", "tag-2", "tag-1"],
  "published-at": "2026-07-20",
  "canonical-url": "https://example.com/blog/sdk-test",
  "legacy-paths": '["/blog/old-sdk-test"]',
  "seo-title": "SDK test SEO",
  "seo-description": "SDK test description",
  "schema-version": 1,
  custom: "preserved",
};

const pageFields = {
  path: "/use-cases/sdk-test",
  title: "SDK Page test",
  slug: "sdk-test",
  locale: "en",
  status: "published",
  template: "landing",
  body: "<section><h1>Build with Busabase</h1></section>",
  hero: '{"headline":"Build with Busabase"}',
  features: [{ title: "Typed reads" }],
  faqs: '[{"q":"Why?","a":"Canonical content."}]',
  "legacy-paths": '["/old-page"]',
  "seo-title": "Page SEO",
  "seo-description": "Page description",
  "schema-version": 1,
};

const taxonomyFields = {
  name: "Engineering",
  slug: "engineering",
  locale: "en",
  description: "Engineering content",
};

const record = (
  id: string,
  fields: Record<string, unknown>,
  status: "active" | "archived" = "active",
): BusabaseCmsRecord => ({
  id,
  status,
  updatedAt: "2026-07-20T00:00:00.000Z",
  headCommit: { fields },
});

const source = (
  pagesByBase: Record<string, Array<{ records: BusabaseCmsRecord[]; nextCursor: string | null }>>,
) => {
  const getBaseBySlug = vi.fn(async (slug: string) => ({ id: `base-${slug}`, slug }));
  const listRecordsPage = vi.fn(async ({ baseId }: { baseId: string }) => {
    const page = pagesByBase[baseId]?.shift();
    if (!page) throw new Error(`Unexpected page request for ${baseId}`);
    return page;
  });
  return { getBaseBySlug, listRecordsPage } satisfies BusabaseCmsSource;
};

describe("createBusabaseCms", () => {
  it("uses the four standard CMS Base slugs", async () => {
    const mock = source({
      [`base-${DEFAULT_POSTS_BASE_SLUG}`]: [
        { records: [record("post-1", postFields)], nextCursor: null },
      ],
      [`base-${DEFAULT_PAGES_BASE_SLUG}`]: [
        { records: [record("page-1", pageFields)], nextCursor: null },
      ],
      [`base-${DEFAULT_CATEGORIES_BASE_SLUG}`]: [
        { records: [record("category-1", taxonomyFields)], nextCursor: null },
      ],
      [`base-${DEFAULT_TAGS_BASE_SLUG}`]: [
        {
          records: [record("tag-1", { ...taxonomyFields, name: "Next.js", slug: "nextjs" })],
          nextCursor: null,
        },
      ],
    });
    const cms = createBusabaseCms({ source: mock });

    await Promise.all([cms.posts.list(), cms.pages.list(), cms.categories.list(), cms.tags.list()]);

    expect(mock.getBaseBySlug.mock.calls).toEqual([
      [DEFAULT_POSTS_BASE_SLUG],
      [DEFAULT_PAGES_BASE_SLUG],
      [DEFAULT_CATEGORIES_BASE_SLUG],
      [DEFAULT_TAGS_BASE_SLUG],
    ]);
  });

  it("maps every standard Post column and normalizes relation ids", async () => {
    const mapped = mapPublishedPostRecord(record("post-1", postFields));

    expect(mapped).toEqual(
      expect.objectContaining({
        id: "post-1",
        path: "/blog/sdk-test",
        coverImage: expect.objectContaining({ attachmentId: "attachment-cover" }),
        attachments: [expect.objectContaining({ assetId: "asset-cover" })],
        categoryIds: ["category-1"],
        tagIds: ["tag-1", "tag-2"],
        legacyPaths: ["/blog/old-sdk-test"],
        seoTitle: "SDK test SEO",
        seoDescription: "SDK test description",
        rawFields: expect.objectContaining({ custom: "preserved" }),
      }),
    );
  });

  it("maps Pages and active taxonomy records, including JSON fields", async () => {
    const mock = source({
      [`base-${DEFAULT_PAGES_BASE_SLUG}`]: [
        { records: [record("page-1", pageFields)], nextCursor: null },
      ],
      [`base-${DEFAULT_CATEGORIES_BASE_SLUG}`]: [
        {
          records: [
            record("archived", taxonomyFields, "archived"),
            record("category-1", taxonomyFields),
          ],
          nextCursor: null,
        },
      ],
      [`base-${DEFAULT_TAGS_BASE_SLUG}`]: [
        {
          records: [record("tag-1", { ...taxonomyFields, name: "Next.js", slug: "nextjs" })],
          nextCursor: null,
        },
      ],
    });
    const cms = createBusabaseCms({ source: mock });

    await expect(cms.pages.list()).resolves.toEqual([
      expect.objectContaining({
        template: "landing",
        body: pageFields.body,
        hero: { headline: "Build with Busabase" },
        features: [{ title: "Typed reads" }],
        faqs: [{ q: "Why?", a: "Canonical content." }],
        legacyPaths: ["/old-page"],
      }),
    ]);
    await expect(cms.categories.getBySlug("engineering")).resolves.toMatchObject({
      id: "category-1",
    });
    await expect(cms.tags.getBySlug("nextjs")).resolves.toMatchObject({ id: "tag-1" });
  });

  it("filters archived and unpublished Posts and Pages", async () => {
    const mock = source({
      [`base-${DEFAULT_POSTS_BASE_SLUG}`]: [
        {
          records: [
            record("draft", { ...postFields, status: "draft" }),
            record("archived", postFields, "archived"),
            record("published", postFields),
          ],
          nextCursor: null,
        },
      ],
    });

    await expect(createBusabaseCms({ source: mock }).posts.list()).resolves.toMatchObject([
      { id: "published" },
    ]);
  });

  it("supports custom Base slugs and exhausts cursor pagination", async () => {
    const mock = source({
      "base-buda-posts": [
        { records: [record("post-1", postFields)], nextCursor: "page-2" },
        { records: [], nextCursor: null },
      ],
    });
    const cms = createBusabaseCms({
      source: mock,
      baseSlugs: { posts: "buda-posts" },
      pageSize: 50,
    });

    await expect(cms.posts.list()).resolves.toHaveLength(1);
    expect(mock.listRecordsPage).toHaveBeenNthCalledWith(1, {
      baseId: "base-buda-posts",
      limit: 50,
      cursor: undefined,
    });
    expect(mock.listRecordsPage).toHaveBeenNthCalledWith(2, {
      baseId: "base-buda-posts",
      limit: 50,
      cursor: "page-2",
    });
  });

  it("reports invalid records or throws in strict mode", async () => {
    const onInvalidRecord = vi.fn();
    const invalidFields = { ...postFields, "legacy-paths": "[not-json" };
    const mock = source({
      [`base-${DEFAULT_POSTS_BASE_SLUG}`]: [
        { records: [record("bad", invalidFields)], nextCursor: null },
      ],
    });

    await expect(
      createBusabaseCms({ source: mock, onInvalidRecord }).posts.list(),
    ).resolves.toEqual([]);
    expect(onInvalidRecord).toHaveBeenCalledWith({
      kind: "post",
      recordId: "bad",
      error: expect.any(BusabaseCmsError),
    });

    const strictMock = source({
      [`base-${DEFAULT_POSTS_BASE_SLUG}`]: [
        { records: [record("bad", invalidFields)], nextCursor: null },
      ],
    });
    await expect(
      createBusabaseCms({ source: strictMock, invalidRecords: "throw" }).posts.list(),
    ).rejects.toThrow('Busabase field "legacy-paths" contains malformed JSON');
  });

  it("validates mutually exclusive sources and page size eagerly", () => {
    const mock = source({});
    expect(() => createBusabaseCms({ source: mock, config: {} })).toThrow(
      "Provide source or client/config, not both",
    );
    expect(() => createBusabaseCms({ source: mock, pageSize: 101 })).toThrow(
      "pageSize must be an integer between 1 and 100",
    );
    expect(() =>
      createBusabaseCms({ source: mock, folderId: "folder-cms", lazyCreate: true }),
    ).toThrow("custom source requires node, Base, field, and metadata provisioning methods");
  });
});
