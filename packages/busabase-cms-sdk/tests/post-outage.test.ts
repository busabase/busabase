import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));

import type { CmsRead } from "../src/fallback";
import { createCmsPostReads, createCmsPostResolver } from "../src/integration/posts";
import type { PostVO } from "../src/types";

const post = (path: string, locale: string) => ({ path, locale }) as PostVO;
const buildCmsPath = (locale: string, path: string | readonly string[]) =>
  `${locale === "en" ? "" : `/${locale}`}/${typeof path === "string" ? path : path.join("/")}`;

/** A resolver whose CMS answers per path: a post, `null` (no such post) or an outage. */
const resolverFor = (
  cms: Record<string, PostVO | null | "down">,
  localPages: Record<string, Record<string, { data: object }>> = {},
) =>
  createCmsPostResolver({
    integration: {
      buildCmsPath,
      parseCmsPath: () => null,
      isCmsContentForLocale: () => true,
      getBusabaseBlogPostByPathOrFallback: async () => null,
      readBusabaseBlogPostByPath: async (path): Promise<CmsRead<PostVO | null>> => {
        const answer = cms[path] ?? null;
        return answer === "down" ? { status: "unavailable" } : { status: "ok", data: answer };
      },
    },
    localSource: {
      getPage: (slugs: string[], locale?: string) => localPages[slugs.join("/")]?.[locale ?? "en"],
    },
    supportedLocales: ["en", "zh-CN"],
    defaultLocale: "en",
  });

describe("Post resolution through a CMS outage", () => {
  it("throws instead of reporting a post that may exist as missing", async () => {
    const resolver = resolverFor({ "/blog/launch": "down" });
    await expect(resolver.resolvePostPage("en", "launch")).rejects.toThrow(/unreachable/);
  });

  it("still reports a real miss when the CMS answered", async () => {
    const resolver = resolverFor({ "/blog/launch": null });
    expect(await resolver.resolvePostPage("en", "launch")).toBeNull();
  });

  it("serves the post's own local file when only the CMS is down", async () => {
    const enPage = { data: { title: "Launch" } };
    const resolver = resolverFor({ "/blog/launch": "down" }, { launch: { en: enPage } });
    expect(await resolver.resolvePostPage("en", "launch")).toMatchObject({
      source: "local",
      content: enPage,
      isLocaleFallback: false,
    });
  });

  it("does not fall back to English when the requested locale's read failed", async () => {
    const resolver = resolverFor({
      "/zh-CN/blog/launch": "down",
      "/blog/launch": post("/blog/launch", "en"),
    });
    // A Chinese translation may exist; serving English would cache an English canonical.
    await expect(resolver.resolvePostPage("zh-CN", "launch")).rejects.toThrow();
  });

  it("falls back to English when the requested locale answered and only has no post", async () => {
    const resolver = resolverFor({
      "/zh-CN/blog/launch": null,
      "/blog/launch": post("/blog/launch", "en"),
    });
    expect(await resolver.resolvePostPage("zh-CN", "launch")).toMatchObject({
      source: "busabase",
      contentLocale: "en",
      isLocaleFallback: true,
    });
  });

  it("throws when the English retry is the read that failed", async () => {
    const resolver = resolverFor({ "/zh-CN/blog/launch": null, "/blog/launch": "down" });
    await expect(resolver.resolvePostPage("zh-CN", "launch")).rejects.toThrow();
  });

  it("applies the same rule to exact-locale metadata (no English retry)", async () => {
    const resolver = resolverFor({ "/zh-CN/blog/launch": "down" });
    await expect(
      resolver.resolvePostMetadataInput("zh-CN", "launch", { localeFallback: false }),
    ).rejects.toThrow();
  });

  it("keeps the fallback behaviour for an integration without the status-aware read", async () => {
    const resolver = createCmsPostResolver({
      integration: {
        buildCmsPath,
        parseCmsPath: () => null,
        isCmsContentForLocale: () => true,
        getBusabaseBlogPostByPathOrFallback: async () => null,
      },
      localSource: { getPage: () => undefined },
    });
    expect(await resolver.resolvePostPage("en", "launch")).toBeNull();
  });
});

describe("status-aware Post reads", () => {
  const failingCms = {
    posts: {
      list: async () => {
        throw new Error("fetch failed");
      },
      getByPath: async () => {
        throw new Error("fetch failed");
      },
    },
  };
  const readsFor = (cms: unknown) =>
    createCmsPostReads({ getCms: () => cms, requireCms: () => cms } as never, "Test");

  it("treats an unconfigured CMS as an empty, successful read", async () => {
    const reads = readsFor(null);
    expect(await reads.readBusabaseBlogPosts()).toEqual({ status: "ok", data: [] });
    expect(await reads.readBusabaseBlogPostByPath("/blog/x")).toEqual({ status: "ok", data: null });
  });

  it("reports a configured CMS that fails as unavailable, never as empty", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reads = readsFor(failingCms);
    expect(await reads.readBusabaseBlogPosts()).toEqual({ status: "unavailable" });
    expect(await reads.readBusabaseBlogPostByPath("/blog/x")).toEqual({ status: "unavailable" });
  });
});
