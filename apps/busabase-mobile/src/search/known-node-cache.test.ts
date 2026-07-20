import { describe, expect, it } from "vitest";
import {
  type AsyncKeyValueStorage,
  createKnownNodeCache,
  createKnownNodeCacheScope,
  findKnownNodeByTypeAndSlug,
  type KnownNode,
} from "./known-node-cache";
import { getMobileNodeDestination } from "./node-navigation";

class MemoryStorage implements AsyncKeyValueStorage {
  values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  async getItem(key: string) {
    if (this.failReads) throw new Error("storage unavailable");
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }

  async removeItem(key: string) {
    if (this.failWrites) throw new Error("storage unavailable");
    this.values.delete(key);
  }
}

const node = (id: string, overrides: Partial<KnownNode> = {}): KnownNode => ({
  id,
  type: "base",
  name: `Node ${id}`,
  slug: `node-${id}`,
  path: `/base/node-${id}`,
  ...overrides,
});

describe("mobile KnownNode cache", () => {
  it("isolates server, space, and user scopes", () => {
    expect(createKnownNodeCacheScope("HTTPS://EXAMPLE.COM/", "space-a", "alice")).toBe(
      "https://example.com:space-a:alice",
    );
    expect(createKnownNodeCacheScope("https://example.com", "space-b", "alice")).not.toBe(
      createKnownNodeCacheScope("https://example.com", "space-a", "alice"),
    );
    expect(createKnownNodeCacheScope("https://example.com", "space-a", "bob")).not.toBe(
      createKnownNodeCacheScope("https://example.com", "space-a", "alice"),
    );
  });

  it("resolves content-search paths to the matching cached node id", () => {
    const nodes = [
      node("drive-id", { type: "drive", slug: "roadmap" }),
      node("doc-id", { type: "doc", slug: "roadmap" }),
    ];

    expect(findKnownNodeByTypeAndSlug(nodes, "drive", "roadmap")?.id).toBe("drive-id");
    expect(findKnownNodeByTypeAndSlug(nodes, "doc", "roadmap")?.id).toBe("doc-id");
    expect(findKnownNodeByTypeAndSlug(nodes, "skill", "roadmap")).toBeUndefined();
  });

  it("merges fresh node fields, persists them, and preserves visits", async () => {
    const storage = new MemoryStorage();
    const cache = createKnownNodeCache("scope", storage);
    await cache.merge([node("1", { name: "Old name" })]);
    await cache.markVisited("1", "2026-07-19T00:00:00.000Z");
    await cache.merge([node("1", { name: "New name", slug: "new-name", path: "/base/new-name" })]);

    const reloaded = createKnownNodeCache("scope", storage);
    expect(await reloaded.list()).toEqual([
      expect.objectContaining({
        id: "1",
        name: "New name",
        slug: "new-name",
        lastVisitedAt: "2026-07-19T00:00:00.000Z",
      }),
    ]);
  });

  it("lists only visited nodes newest-first and fuzzy matches name or slug", async () => {
    const cache = createKnownNodeCache("scope", new MemoryStorage());
    await cache.merge([
      node("1", { name: "Roadmap Base", slug: "roadmap" }),
      node("2", { name: "Design Notes", slug: "product-design" }),
      node("3", { name: "Unvisited" }),
    ]);
    await cache.markVisited("1", "2026-07-18T00:00:00.000Z");
    await cache.markVisited("2", "2026-07-20T00:00:00.000Z");

    expect((await cache.listVisited()).map(({ id }) => id)).toEqual(["2", "1"]);
    expect((await cache.fuzzyMatch("ROADMAP")).map(({ id }) => id)).toEqual(["1"]);
    expect((await cache.fuzzyMatch("product-design")).map(({ id }) => id)).toEqual(["2"]);
  });

  it("serializes concurrent mutations so persistence keeps every node", async () => {
    const storage = new MemoryStorage();
    const cache = createKnownNodeCache("scope", storage);
    await Promise.all([cache.merge([node("1")]), cache.merge([node("2")])]);

    const reloaded = createKnownNodeCache("scope", storage);
    expect((await reloaded.list()).map(({ id }) => id)).toEqual(["1", "2"]);
  });

  it("notifies active consumers after a late cache update", async () => {
    const cache = createKnownNodeCache("scope", new MemoryStorage());
    let updates = 0;
    const unsubscribe = cache.subscribe(() => updates++);

    await cache.merge([node("1")]);
    await cache.markVisited("1", "2026-07-20T00:00:00.000Z");
    unsubscribe();
    await cache.merge([node("2")]);

    expect(updates).toBe(2);
  });

  it("ignores corrupt entries and survives storage failures in memory", async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      "busabase-mobile.known-node-cache.v1:scope",
      JSON.stringify([{ id: "broken" }, node("valid")]),
    );
    const cache = createKnownNodeCache("scope", storage);
    expect((await cache.list()).map(({ id }) => id)).toEqual(["valid"]);

    const unavailable = new MemoryStorage();
    unavailable.failReads = true;
    unavailable.failWrites = true;
    const memoryOnly = createKnownNodeCache("offline", unavailable);
    await expect(memoryOnly.merge([node("local")])).resolves.toBeUndefined();
    expect((await memoryOnly.list()).map(({ id }) => id)).toEqual(["local"]);
  });

  it("caps the cache and evicts unvisited nodes before visited nodes", async () => {
    const cache = createKnownNodeCache("scope", new MemoryStorage());
    await cache.merge(Array.from({ length: 1000 }, (_, index) => node(String(index))));
    await cache.markVisited("0", "2026-07-20T00:00:00.000Z");
    await cache.merge([node("overflow")]);

    const all = await cache.list();
    expect(all).toHaveLength(1000);
    expect(all.some(({ id }) => id === "0")).toBe(true);
    expect(all.some(({ id }) => id === "1")).toBe(false);
  });
});

describe("mobile node navigation", () => {
  it("uses slug only for bases and ids for the other supported node routes", () => {
    expect(getMobileNodeDestination(node("base-id", { type: "base", slug: "roadmap" }))).toEqual({
      status: "ready",
      pathname: "/base/[slug]",
      params: { slug: "roadmap" },
    });
    for (const type of ["folder", "skill", "drive", "airapp", "doc"] as const) {
      expect(getMobileNodeDestination(node(`${type}-id`, { type }))).toEqual({
        status: "ready",
        pathname: `/${type}/[nodeId]`,
        params: { nodeId: `${type}-id` },
      });
    }
  });

  it("does not create a route for standalone files", () => {
    expect(getMobileNodeDestination(node("file-id", { type: "file" }))).toEqual({
      status: "unsupported",
      message: "Standalone files aren't viewable on mobile yet.",
    });
  });
});
