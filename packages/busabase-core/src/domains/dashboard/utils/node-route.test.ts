import { NODE_TYPES } from "busabase-contract/domains";
import { describe, expect, it } from "vitest";
import {
  parseNodeActivityRoute,
  parseNodeDetailRoute,
  parseSidebarNodeRoute,
  replaceNodeRouteSlug,
} from "./node-route";

describe("parseNodeDetailRoute", () => {
  it("reads `/{type}/{slug}` for a type that has a detail screen", () => {
    expect(parseNodeDetailRoute("/folder/brand-kit")).toEqual({
      type: "folder",
      slug: "brand-kit",
    });
    expect(parseNodeDetailRoute("/doc/launch-plan")).toEqual({ type: "doc", slug: "launch-plan" });
  });

  it("ignores the query string", () => {
    expect(parseNodeDetailRoute("/folder/brand-kit?demo=1&lang=zh-CN")).toEqual({
      type: "folder",
      slug: "brand-kit",
    });
  });

  it("decodes a percent-escaped slug, and keeps a malformed one as-is", () => {
    expect(parseNodeDetailRoute("/doc/q3%20plan")).toEqual({ type: "doc", slug: "q3 plan" });
    // `%zz` is not a valid escape — `decodeURIComponent` throws on it, and the
    // route must still resolve rather than being dropped entirely.
    expect(parseNodeDetailRoute("/doc/q3%zz")).toEqual({ type: "doc", slug: "q3%zz" });
  });

  it("rejects Bases — their own deeper routes share this two-segment shape", () => {
    expect(parseNodeDetailRoute("/base/blog-posts")).toBeNull();
  });

  it("recognizes every registered detail type except Base", () => {
    for (const type of NODE_TYPES) {
      if (type === "base") continue;
      expect(parseNodeDetailRoute(`/${type}/route-state-check`)).toEqual({
        type,
        slug: "route-state-check",
      });
    }
  });

  it("rejects routes that merely look like a node route", () => {
    // Same shape, not a node type.
    expect(parseNodeDetailRoute("/inbox/cr_123")).toBeNull();
    expect(parseNodeDetailRoute("/agents/some-agent")).toBeNull();
    // Wrong segment count.
    expect(parseNodeDetailRoute("/folder")).toBeNull();
    expect(parseNodeDetailRoute("/folder/brand-kit/activity")).toBeNull();
    expect(parseNodeDetailRoute("/")).toBeNull();
  });
});

describe("parseNodeActivityRoute", () => {
  it("reads `/{type}/{slug}/activity` and nothing else", () => {
    expect(parseNodeActivityRoute("/folder/brand-kit/activity")).toEqual({
      type: "folder",
      slug: "brand-kit",
    });
    expect(parseNodeActivityRoute("/folder/brand-kit")).toBeNull();
    expect(parseNodeActivityRoute("/base/blog-posts/activity")).toBeNull();
  });
});

describe("replaceNodeRouteSlug", () => {
  it("moves the node's own detail and activity routes to the new slug", () => {
    expect(replaceNodeRouteSlug("/folder/caio", "folder", "caio", "ai-caio")).toBe(
      "/folder/ai-caio",
    );
    expect(replaceNodeRouteSlug("/skill/weekly/activity", "skill", "weekly", "weekly-v2")).toBe(
      "/skill/weekly-v2/activity",
    );
  });

  it("keeps a Base's deeper route and the query string", () => {
    expect(replaceNodeRouteSlug("/base/crm/design", "base", "crm", "sales-crm")).toBe(
      "/base/sales-crm/design",
    );
    expect(replaceNodeRouteSlug("/base/crm/rec_1/edit?tab=info", "base", "crm", "sales-crm")).toBe(
      "/base/sales-crm/rec_1/edit?tab=info",
    );
  });

  it("leaves every other location alone", () => {
    // Same slug, different type — slugs are only unique within a type.
    expect(replaceNodeRouteSlug("/doc/caio", "folder", "caio", "ai-caio")).toBeNull();
    // Addressed by id: the id did not change, so the url still works.
    expect(replaceNodeRouteSlug("/folder/nod_123", "folder", "caio", "ai-caio")).toBeNull();
    // A different node, or not a node page at all.
    expect(replaceNodeRouteSlug("/folder/caio-archive", "folder", "caio", "x")).toBeNull();
    expect(replaceNodeRouteSlug("/inbox", "folder", "caio", "x")).toBeNull();
    expect(replaceNodeRouteSlug("/folder", "folder", "caio", "x")).toBeNull();
  });
});

describe("parseSidebarNodeRoute", () => {
  it("locates a Base from every one of its routes", () => {
    const base = { type: "base", slug: "product-public-pool-accounts" };
    expect(parseSidebarNodeRoute("/base/product-public-pool-accounts")).toEqual(base);
    expect(parseSidebarNodeRoute("/base/product-public-pool-accounts/grid-view")).toEqual(base);
    expect(parseSidebarNodeRoute("/base/product-public-pool-accounts/rec_1/edit")).toEqual(base);
    expect(parseSidebarNodeRoute("/base/product-public-pool-accounts/design?lang=zh-CN")).toEqual(
      base,
    );
  });

  it("also covers node detail and activity routes", () => {
    expect(parseSidebarNodeRoute("/folder/brand-kit")).toEqual({
      type: "folder",
      slug: "brand-kit",
    });
    expect(parseSidebarNodeRoute("/doc/launch-plan/activity")).toEqual({
      type: "doc",
      slug: "launch-plan",
    });
  });

  it("returns null for routes that address no node", () => {
    expect(parseSidebarNodeRoute("/inbox/cr_123")).toBeNull();
    expect(parseSidebarNodeRoute("/base")).toBeNull();
    expect(parseSidebarNodeRoute("/")).toBeNull();
  });
});
