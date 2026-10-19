import { describe, expect, it } from "vitest";
import { buildBreadcrumbJsonLd } from "./breadcrumb-jsonld";

describe("buildBreadcrumbJsonLd", () => {
  const items = [
    { name: "Home", path: "/" },
    { name: "Blog", path: "/blog" },
  ];
  const urls = (lang: string) =>
    buildBreadcrumbJsonLd(items, { siteUrl: "https://acme.dev", lang }).itemListElement.map(
      (i) => i.item,
    );

  it("points the Home crumb at the home canonical, without a trailing slash", () => {
    expect(urls("en")).toEqual(["https://acme.dev", "https://acme.dev/blog"]);
  });

  it("prefixes a non-default locale", () => {
    expect(urls("zh-CN")).toEqual(["https://acme.dev/zh-CN", "https://acme.dev/zh-CN/blog"]);
  });

  it("numbers the trail from 1", () => {
    const list = buildBreadcrumbJsonLd(items, { siteUrl: "https://acme.dev", lang: "en" });
    expect(list.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    expect(list["@type"]).toBe("BreadcrumbList");
  });
});
