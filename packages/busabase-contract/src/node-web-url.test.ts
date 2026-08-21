import { describe, expect, it } from "vitest";
import { nodeWebUrl } from "./node-web-url";

describe("nodeWebUrl", () => {
  it("builds the canonical root-host shape", () => {
    expect(
      nodeWebUrl({
        webOrigin: "https://busabase.com",
        spaceId: "org_123",
        nodeType: "doc",
        nodeSlug: "q3-pricing",
      }),
    ).toBe("https://busabase.com/dashboard/org_123/doc/q3-pricing");
  });

  it("drops the space segment on a workspace subdomain", () => {
    // The space is already implied by the hostname there, so the route is the
    // short `/dashboard/<type>/<slug>` form.
    expect(
      nodeWebUrl({
        webOrigin: "https://acme.busabase.com",
        spaceId: null,
        nodeType: "base",
        nodeSlug: "customers",
      }),
    ).toBe("https://acme.busabase.com/dashboard/base/customers");
  });

  it("appends extra segments in route order, e.g. a record under a Base", () => {
    expect(
      nodeWebUrl({
        webOrigin: "https://busabase.com",
        spaceId: "org_123",
        nodeType: "base",
        nodeSlug: "customers",
        extraSegments: ["rec_456"],
      }),
    ).toBe("https://busabase.com/dashboard/org_123/base/customers/rec_456");
  });

  it("accepts an API base URL, since callers usually only have that one", () => {
    // Same-origin on Cloud and on a local OSS server, and the SDK's only origin
    // field is the API root — so tolerate the `/api/v1` suffix rather than make
    // every caller strip it.
    expect(
      nodeWebUrl({
        webOrigin: "http://localhost:15419/api/v1",
        spaceId: "local",
        nodeType: "folder",
        nodeSlug: "notes",
      }),
    ).toBe("http://localhost:15419/dashboard/local/folder/notes");
  });

  it("tolerates trailing slashes", () => {
    expect(
      nodeWebUrl({
        webOrigin: "https://busabase.com///",
        spaceId: "org_1",
        nodeType: "doc",
        nodeSlug: "a",
      }),
    ).toBe("https://busabase.com/dashboard/org_1/doc/a");
  });

  it("ignores any path the caller left on the origin", () => {
    expect(
      nodeWebUrl({
        webOrigin: "https://busabase.com/dashboard/org_9",
        spaceId: "org_1",
        nodeType: "doc",
        nodeSlug: "a",
      }),
    ).toBe("https://busabase.com/dashboard/org_1/doc/a");
  });

  it("percent-encodes every segment, so a slug cannot retarget the link", () => {
    // A slug is user-controlled text. Un-encoded, `../` or a bare `?` would
    // point the link somewhere else entirely.
    expect(
      nodeWebUrl({
        webOrigin: "https://busabase.com",
        spaceId: "org_123",
        nodeType: "doc",
        nodeSlug: "../../admin?x=1",
      }),
    ).toBe("https://busabase.com/dashboard/org_123/doc/..%2F..%2Fadmin%3Fx%3D1");
  });

  it("encodes a space id with regional characters rather than emitting it raw", () => {
    expect(
      nodeWebUrl({
        webOrigin: "https://busabase.com",
        spaceId: "空间 1",
        nodeType: "doc",
        nodeSlug: "笔记",
      }),
    ).toBe("https://busabase.com/dashboard/%E7%A9%BA%E9%97%B4%201/doc/%E7%AC%94%E8%AE%B0");
  });

  it("drops blank extra segments instead of emitting an empty path part", () => {
    expect(
      nodeWebUrl({
        webOrigin: "https://busabase.com",
        spaceId: "org_1",
        nodeType: "base",
        nodeSlug: "customers",
        extraSegments: ["", "rec_1"],
      }),
    ).toBe("https://busabase.com/dashboard/org_1/base/customers/rec_1");
  });

  it("throws on an unparseable origin instead of returning a broken link", () => {
    expect(() =>
      nodeWebUrl({
        webOrigin: "not-a-url",
        spaceId: "org_1",
        nodeType: "doc",
        nodeSlug: "a",
      }),
    ).toThrow(TypeError);
  });
});
