import { describe, expect, it } from "vitest";
import { parseNodeActivityRoute, parseNodeDetailRoute } from "./node-route";

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
