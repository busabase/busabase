import { type APIRequestContext, expect, json, test } from "./_fixtures";

// Contract-level checks for the public REST surface (`/api/health` + the oRPC
// OpenAPI router at `/api/v1`). These are API-only (no browser), so they are fast
// and deterministic. Reads go through the stateless demo router (`?demo=1`) where
// possible so they never touch the dev DB; the write-shaped negative cases target
// the real DB but only assert the error contract (they create nothing).

interface BaseVO {
  id: string;
  slug: string;
}

interface ChangeRequestVO {
  id: string;
  status: string;
}

interface RecordVO {
  id: string;
  base: { slug: string };
  headCommit: { payload: Record<string, unknown> };
}

interface NodeSummaryVO {
  id: string;
  slug: string;
  type: string;
  children: unknown[];
}

const getBlogBase = async (request: APIRequestContext) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const blog = bases.find((base) => base.slug === "blog");
  if (!blog) {
    throw new Error("Blog base not found — is the DB seeded (pnpm db:seed:all)?");
  }
  return blog;
};

test("GET /api/health reports the service as ok", async ({ request }) => {
  const body = await json<{ service: string; status: string; timestamp: string }>(
    await request.get("/api/health"),
  );
  expect(body.service).toBe("busabase");
  expect(body.status).toBe("ok");
  expect(typeof body.timestamp).toBe("string");
});

test("OPTIONS /api/health advertises the allowed CORS methods", async ({ request }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL ?? "http://localhost:15419");
  const response = await request.fetch(new URL("/api/health", baseURL).toString(), {
    method: "OPTIONS",
  });
  expect(response.status()).toBe(204);
  const allow = response.headers()["access-control-allow-methods"] ?? "";
  expect(allow).toContain("GET");
  expect(allow).toContain("OPTIONS");
});

test("GET /api/v1/bases returns the seeded bases", async ({ request }) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const slugs = bases.map((base) => base.slug);
  expect(slugs).toEqual(expect.arrayContaining(["blog", "field-type-lab"]));
});

test("GET /api/v1/change-requests?demo=1 serves the seeded review queue", async ({ request }) => {
  const page = await json<{ changeRequests: ChangeRequestVO[]; nextCursor: string | null }>(
    await request.get("/api/v1/change-requests?demo=1"),
  );
  const { changeRequests } = page;
  expect(changeRequests.length).toBeGreaterThan(0);
  // Every seeded CR carries a known status vocabulary.
  const statuses = new Set(changeRequests.map((cr) => cr.status));
  for (const status of statuses) {
    expect([
      "in_review",
      "changes_requested",
      "approved",
      "merged",
      "conflict",
      "rejected",
      "abandoned",
    ]).toContain(status);
  }
});

test("GET /api/v1/records/search filters canonical records by field text", async ({ request }) => {
  // Discover a real (field, value) pair from a seeded demo record, then filter by it —
  // robust to whatever the seed happens to contain.
  const page = await json<{ records: RecordVO[]; nextCursor: string | null }>(
    await request.get("/api/v1/records?demo=blog"),
  );
  const { records } = page;
  expect(records.length).toBeGreaterThan(0);
  const sample = records.find((record) =>
    Object.values(record.headCommit.payload).some(
      (value) => typeof value === "string" && value.trim().length > 0,
    ),
  );
  if (!sample) {
    throw new Error("No demo blog record with a non-empty text field");
  }
  const [fieldSlug, rawValue] = Object.entries(sample.headCommit.payload).find(
    ([, value]) => typeof value === "string" && value.trim().length > 0,
  ) as [string, string];

  const matches = await json<RecordVO[]>(
    await request.get(
      `/api/v1/records/search?demo=blog&fieldSlug=${encodeURIComponent(fieldSlug)}&valueText=${encodeURIComponent(rawValue)}`,
    ),
  );
  expect(matches.some((record) => record.id === sample.id)).toBe(true);
});

test("GET /api/v1/search finds seeded content across groups", async ({ request }) => {
  const response = await request.get("/api/v1/search?demo=1&query=agent");
  expect(response.ok()).toBe(true);
  // The seeded blog content is about AI agents; assert the term surfaces regardless
  // of the exact grouping shape (records / bases / change-requests).
  const serialized = JSON.stringify(await response.json()).toLowerCase();
  expect(serialized).toContain("agent");
});

test("status=archived returns archived bases and nodes", async ({ request }) => {
  const archivedBases = await json<unknown[]>(
    await request.get("/api/v1/bases?status=archived&demo=1"),
  );
  expect(Array.isArray(archivedBases)).toBe(true);
  const archivedNodes = await json<unknown[]>(
    await request.get("/api/v1/nodes?status=archived&demo=1"),
  );
  expect(Array.isArray(archivedNodes)).toBe(true);
});

test("GET an unknown base id returns the structured 404 contract", async ({ request }) => {
  const response = await request.get("/api/v1/bases/does-not-exist");
  expect(response.status()).toBe(404);
  expect(await response.json()).toMatchObject({
    code: "NOT_FOUND",
    error: expect.stringContaining("Base not found"),
  });
});

test("GET an unknown change request id returns 404, not 500", async ({ request }) => {
  // A missing get-by-id resource is NOT_FOUND (client error), not a server crash.
  const response = await request.get("/api/v1/change-requests/does-not-exist");
  expect(response.status()).toBe(404);
});

test("GET an unknown record id returns 404, not 500", async ({ request }) => {
  const response = await request.get("/api/v1/records/get?recordId=does-not-exist");
  expect(response.status()).toBe(404);
});

test("retired record get paths are not public routes", async ({ request }) => {
  expect((await request.get("/api/v1/records/does-not-exist")).status()).toBe(404);
  expect(
    (
      await request.get("/api/v1/records/by-field?baseId=bse_x&fieldSlug=slug&valueText=missing")
    ).status(),
  ).toBe(404);
});

// ── Unified Node surface ────────────────────────────────────────────────────
//
// `GET /docs`, `/files`, `/folders`, `/file-trees` and their four
// `/{nodeId}` gets were retired in favour of `GET /nodes?types=…` (flat
// lightweight summaries) and `GET /nodes/{nodeId}` (typed detail). These run
// over REAL HTTP rather than the contract object, because the failure worth
// guarding against is a routing one: a surviving template quietly answering an
// old path with a misleading 200/null instead of an honest 404.

test("retired typed Node list/get paths are no longer public routes", async ({ request }) => {
  for (const path of [
    "/api/v1/docs",
    "/api/v1/docs/some-slug",
    "/api/v1/files",
    "/api/v1/files/some-slug",
    "/api/v1/folders",
    "/api/v1/folders/some-slug",
    "/api/v1/file-trees",
    "/api/v1/file-trees/some-slug",
  ]) {
    const response = await request.get(path);
    expect(response.status(), `${path} must 404`).toBe(404);
    // The router's own "no route matched" envelope — NOT the `NOT_FOUND` code a
    // live handler returns for a missing row. Asserting the envelope is what
    // separates "this path is gone" from "this path still exists and answered".
    expect(await response.json(), `${path} must not be served by any handler`).toMatchObject({
      error: "Not found",
      path,
    });
  }
});

test("POST /docs and POST /file-trees survived the consolidation", async ({ request }) => {
  // Only list/get were retired. A missing-body POST must still reach the real
  // handler and fail validation (4xx) rather than 404 as an unknown route.
  for (const path of ["/api/v1/docs", "/api/v1/file-trees"]) {
    const response = await request.post(path, { data: {} });
    expect(response.status(), `${path} must still be routed`).not.toBe(404);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  }
});

test("GET /api/v1/nodes?types= returns flat summaries, not hydrated detail", async ({
  request,
}) => {
  // A single occurrence deserializes to a bare string, a repeated one to an
  // array — both have to work or the curl/CLI form of the endpoint that
  // replaced `GET /docs` silently 400s.
  const docs = await json<NodeSummaryVO[]>(await request.get("/api/v1/nodes?demo=1&types=doc"));
  expect(docs.length).toBeGreaterThan(0);
  expect(docs.every((node) => node.type === "doc")).toBe(true);
  // The whole point of the replacement: summaries hydrate nothing expensive.
  expect(docs.every((node) => node.children.length === 0)).toBe(true);
  expect(docs.every((node) => !("body" in node))).toBe(true);

  const fileTrees = await json<NodeSummaryVO[]>(
    await request.get("/api/v1/nodes?demo=1&types=skill&types=drive&types=airapp"),
  );
  expect(fileTrees.every((node) => ["skill", "drive", "airapp"].includes(node.type))).toBe(true);
  expect(fileTrees.every((node) => !("files" in node))).toBe(true);

  // There is no synthetic "file-tree" node type — asking for one must be a
  // clear client error, not an empty list that reads as "you have no Skills".
  expect((await request.get("/api/v1/nodes?demo=1&types=file-tree")).status()).toBe(400);
});

test("GET /api/v1/nodes/{nodeId} returns typed detail for a real node", async ({ request }) => {
  const tree = await json<Array<{ id: string; children: Array<{ id: string }> }>>(
    await request.get("/api/v1/nodes?demo=1"),
  );
  const root = tree[0];
  const target = root?.children?.[0] ?? root;
  expect(target?.id).toBeTruthy();

  const detail = await json<{ type: string; node: { id: string } }>(
    await request.get(`/api/v1/nodes/${target?.id}?demo=1`),
  );
  expect(detail.type).toBeTruthy();
  expect(detail.node.id).toBe(target?.id);
});

test("GET /api/v1/nodes/{nodeId} 404s an unknown id through the template", async ({ request }) => {
  const response = await request.get("/api/v1/nodes/nod_definitely_missing");
  expect(response.status()).toBe(404);
  // The template matched and the handler said "no such node" — distinct from
  // the router-level "Not found" envelope the retired paths return.
  expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
});

test("literal /nodes/search and /nodes/favorites are not swallowed by /nodes/{nodeId}", async ({
  request,
}) => {
  // Both are literal paths that now share a prefix with the new template. If
  // the template ever won, neither would fail loudly — they would resolve as
  // `nodeId: "search"` / `nodeId: "favorites"` and return a misleading
  // "node not found".
  const search = await json<unknown[]>(await request.get("/api/v1/nodes/search?demo=1&query=a"));
  expect(Array.isArray(search)).toBe(true);

  const favorites = await json<unknown[]>(await request.get("/api/v1/nodes/favorites?demo=1"));
  expect(Array.isArray(favorites)).toBe(true);
});

test("POST a change request with an invalid body is rejected as a client error", async ({
  request,
}) => {
  const blog = await getBlogBase(request);
  const response = await request.post(`/api/v1/bases/${blog.id}/change-requests`, {
    data: {},
  });
  expect(response.status()).toBeGreaterThanOrEqual(400);
  expect(response.status()).toBeLessThan(500);
  const body = await response.json();
  expect(JSON.stringify(body)).toMatch(/code|message|required|invalid/i);
});
