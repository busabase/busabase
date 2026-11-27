import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusabaseCmsRecord, BusabaseCmsSource } from "../src/source";

const { entries, values } = vi.hoisted(() => ({
  entries: [] as Array<{ key: string[]; options: unknown }>,
  values: new Map<string, unknown>(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (
    read: (...args: string[]) => Promise<unknown>,
    key: string[],
    options: unknown,
  ) => {
    entries.push({ key, options });
    return async (...args: string[]) => {
      const identity = JSON.stringify([key, args]);
      if (values.has(identity)) return values.get(identity);
      const result = await read(...args);
      values.set(identity, result);
      return result;
    };
  },
}));

import { createCachedBusabaseCms } from "../src/next";

const attachment = {
  id: "image",
  url: "https://example.com/image.png",
  fileName: "cover.png",
  mimeType: "image/png",
  size: 100,
};
const record: BusabaseCmsRecord = {
  id: "post",
  status: "active",
  updatedAt: "2026-11-19T00:00:00.000Z",
  headCommit: {
    payload: {
      path: "/blog/post",
      title: "Original post",
      slug: "post",
      locale: "en",
      status: "published",
      body: "# Original body",
      "cover-image": attachment,
      attachments: [attachment],
    },
  },
};

beforeEach(() => {
  entries.length = 0;
  values.clear();
});

describe("separate Post summary caching", () => {
  it("isolates index results, full lists, point reads and namespaces while sharing Posts tags/TTL", async () => {
    const source: BusabaseCmsSource = {
      getBaseBySlug: vi.fn(async (slug: string) => ({ id: slug, slug })),
      listRecordsPage: vi.fn(async () => ({ records: [record], nextCursor: null })),
      getRecordByField: vi.fn(async () => record),
    };
    const options = { source, baseSlugs: { posts: "buda-blog-posts" } };
    const cms = createCachedBusabaseCms(options, {
      keyPrefix: ["buda", "space-one"],
      revalidate: 432,
      tags: { posts: ["buda:cms-posts"] },
    });
    const summaries = await cms.posts.listSummaries();
    await expect(cms.posts.listSummaries()).resolves.toEqual(summaries);
    expect(source.listRecordsPage).toHaveBeenCalledTimes(1);
    expect(summaries[0]).not.toHaveProperty("body");
    expect(summaries[0]).not.toHaveProperty("coverImage");
    expect(summaries[0].rawFields).not.toHaveProperty("attachments");
    const full = await cms.posts.list();
    expect(full[0]).toMatchObject({
      body: "# Original body",
      coverImage: { url: attachment.url },
      attachments: [{ url: attachment.url }],
    });
    await cms.posts.list();
    expect(source.listRecordsPage).toHaveBeenCalledTimes(2);
    expect(await cms.posts.getByPath("/blog/post")).toEqual(full[0]);
    await cms.posts.getByPath("/blog/post");
    expect(source.getRecordByField).toHaveBeenCalledTimes(1);
    const summaryKey = entries.find(({ key }) => key.at(-1) === "buda-blog-posts:summaries");
    expect(summaryKey).toEqual({
      key: ["buda", "space-one", "posts", "buda-blog-posts:summaries"],
      options: { revalidate: 432, tags: ["buda:cms-posts"] },
    });
    expect(entries.find(({ key }) => key.at(-1) === "buda-blog-posts")).toEqual({
      key: ["buda", "space-one", "posts", "buda-blog-posts"],
      options: summaryKey?.options,
    });
    const other = createCachedBusabaseCms(options, { keyPrefix: ["buda", "space-two"] });
    await other.posts.listSummaries();
    expect(source.listRecordsPage).toHaveBeenCalledTimes(3);
  });

  it("retries failed summary reads and leaves full content separately available", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ records: [record], nextCursor: null });
    const cms = createCachedBusabaseCms(
      { source: { getBaseBySlug: async (slug) => ({ id: slug, slug }), listRecordsPage: list } },
      { keyPrefix: ["recovery"] },
    );
    await expect(cms.posts.listSummaries()).rejects.toThrow("offline");
    await expect(cms.posts.listSummaries()).resolves.toMatchObject([{ id: "post" }]);
    await expect(cms.posts.listSummaries()).resolves.toMatchObject([{ id: "post" }]);
    expect(list).toHaveBeenCalledTimes(2);
    await expect(cms.posts.list()).resolves.toMatchObject([{ body: "# Original body" }]);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("checks the budget on origin reads while preserving oversized custom metadata", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const large = {
        ...record,
        headCommit: {
          payload: {
            ...record.headCommit.payload,
            custom: "汉".repeat(700_000),
            privateMarker: "do-not-log-source-data",
          },
        },
      };
      const listRecordsPage = vi.fn(async () => ({ records: [large], nextCursor: null }));
      const cms = createCachedBusabaseCms(
        {
          source: {
            getBaseBySlug: async (slug) => ({ id: slug, slug }),
            listRecordsPage,
          },
        },
        { keyPrefix: ["summary-budget"] },
      );
      const first = await cms.posts.listSummaries();
      expect(first[0].rawFields.custom).toBe(large.headCommit.payload.custom);
      await expect(cms.posts.listSummaries()).resolves.toEqual(first);
      expect(listRecordsPage).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledOnce();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("do-not-log-source-data");
      expect(warn.mock.calls[0][1]).toMatchObject({ kind: "posts", recordCount: 1 });
      await cms.posts.list();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
