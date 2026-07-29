import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseDemoRouter } from "../src/router-demo";

/**
 * Route-collision proof for the unified Node detail route.
 *
 * `GET /nodes/{nodeId}` is a template that now shares its prefix with two
 * LITERAL routes that existed first: `GET /nodes/search` (quick-jump) and
 * `GET /nodes/favorites`. If the template ever won, neither would 404 loudly —
 * they would resolve as `nodeId: "search"` / `nodeId: "favorites"` and return a
 * misleading "node not found", which is exactly the failure the consolidation
 * roadmap calls out ("old paths return 404, not a misleading 200/null from a
 * template-route collision").
 *
 * The oRPC OpenAPI matcher is a rou3 radix trie, which prefers a static segment
 * over a param segment regardless of registration order — but "the library
 * currently does the right thing" is not something to leave unasserted, so this
 * drives a REAL `OpenAPIHandler` over real Request objects rather than
 * inspecting the contract.
 *
 * Runs against the demo router because routing is transport-level and the demo
 * router implements the same contract with no database.
 */
const BASE = "http://localhost/api/v1";

const call = async (path: string) => {
  const handler = new OpenAPIHandler(busabaseDemoRouter);
  const result = await runWithBusabaseContext({}, () =>
    handler.handle(new Request(`${BASE}${path}`), { context: {} }),
  );
  if (!result.matched) {
    return { matched: false as const, status: 0, body: undefined as unknown };
  }
  return {
    matched: true as const,
    status: result.response.status,
    body: await result.response.json(),
  };
};

describe("GET /nodes/... route resolution", () => {
  it('resolves /nodes/search as the quick-jump search, not nodeId="search"', async () => {
    const result = await call("/nodes/search?query=a");
    expect(result.matched).toBe(true);
    expect(result.status).toBe(200);
    // searchByName returns an array of search projections; nodes.get would have
    // returned a 404 object for a node literally slugged "search".
    expect(Array.isArray(result.body)).toBe(true);
  });

  it('resolves /nodes/favorites as the favorites list, not nodeId="favorites"', async () => {
    const result = await call("/nodes/favorites");
    expect(result.matched).toBe(true);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
  });

  it("still resolves the template for a real node id", async () => {
    const tree = await call("/nodes");
    const root = (tree.body as Array<{ id: string; children: Array<{ id: string }> }>)[0];
    const target = root?.children?.[0] ?? root;
    expect(target?.id).toBeTruthy();

    const result = await call(`/nodes/${target?.id}`);
    expect(result.status).toBe(200);
    expect((result.body as { type?: string })?.type).toBeTruthy();
  });

  it("404s an unknown node through the template rather than matching nothing", async () => {
    const result = await call("/nodes/nod_definitely_missing");
    expect(result.matched).toBe(true);
    expect(result.status).toBe(404);
  });

  it("no longer serves any of the retired typed get paths", async () => {
    // A real HTTP-shaped miss, not just an absent contract entry: an old client
    // must get an honest 404, never a 200 from some surviving template.
    for (const path of [
      "/docs",
      "/docs/some-slug",
      "/files/some-slug",
      "/folders",
      "/folders/some-slug",
      "/file-trees/some-slug",
    ]) {
      const result = await call(path);
      expect(result.matched, `${path} must not match any route`).toBe(false);
    }
  });
});

describe("GET /nodes?types= over real query strings", () => {
  it("accepts a single occurrence, which arrives as a bare string not an array", async () => {
    // `?types=doc` deserializes to `"doc"`, `?types=doc&types=file` to
    // `["doc", "file"]`. Both have to work or the CLI/curl form of the endpoint
    // that replaced `GET /docs` silently 400s.
    const single = await call("/nodes?types=doc");
    expect(single.status).toBe(200);
    const rows = single.body as Array<{ type: string; children: unknown[] }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.type === "doc")).toBe(true);
    expect(rows.every((row) => row.children.length === 0)).toBe(true);
  });

  it("accepts a repeated occurrence and unions the types", async () => {
    const many = await call("/nodes?types=skill&types=drive");
    expect(many.status).toBe(200);
    const rows = many.body as Array<{ type: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.type === "skill" || row.type === "drive")).toBe(true);
    expect(rows.some((row) => row.type === "skill")).toBe(true);
    expect(rows.some((row) => row.type === "drive")).toBe(true);
  });

  it("rejects a type that is not a real node-type discriminator", async () => {
    // There is no synthetic "file-tree" node type — asking for one must be a
    // clear 400, not an empty list that reads as "you have no Skills".
    const result = await call("/nodes?types=file-tree");
    expect(result.status).toBe(400);
  });

  it("still returns the full tree when types is absent", async () => {
    const tree = await call("/nodes");
    expect(tree.status).toBe(200);
    const rows = tree.body as Array<{ children: unknown[] }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.children.length).toBeGreaterThan(0);
  });
});
