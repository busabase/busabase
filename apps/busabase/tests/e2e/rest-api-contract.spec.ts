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
  headCommit: { fields: Record<string, unknown> };
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
  const changeRequests = await json<ChangeRequestVO[]>(
    await request.get("/api/v1/change-requests?demo=1"),
  );
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
  const records = await json<RecordVO[]>(await request.get("/api/v1/records?demo=blog"));
  expect(records.length).toBeGreaterThan(0);
  const sample = records.find((record) =>
    Object.values(record.headCommit.fields).some(
      (value) => typeof value === "string" && value.trim().length > 0,
    ),
  );
  if (!sample) {
    throw new Error("No demo blog record with a non-empty text field");
  }
  const [fieldSlug, rawValue] = Object.entries(sample.headCommit.fields).find(
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

test("GET /api/v1/bases/archived and /nodes/archived return arrays", async ({ request }) => {
  const archivedBases = await json<unknown[]>(await request.get("/api/v1/bases/archived?demo=1"));
  expect(Array.isArray(archivedBases)).toBe(true);
  const archivedNodes = await json<unknown[]>(await request.get("/api/v1/nodes/archived?demo=1"));
  expect(Array.isArray(archivedNodes)).toBe(true);
});

test("GET an unknown base id is a null-safe read, not a crash", async ({ request }) => {
  // Reading a missing base resolves to `null` with a 200 rather than throwing —
  // the contract is null-safe for base lookups.
  const response = await request.get("/api/v1/bases/does-not-exist");
  expect(response.status()).toBe(200);
  expect(await response.json()).toBeNull();
});

test("GET an unknown change request id returns 404, not 500", async ({ request }) => {
  // A missing get-by-id resource is NOT_FOUND (client error), not a server crash.
  const response = await request.get("/api/v1/change-requests/does-not-exist");
  expect(response.status()).toBe(404);
});

test("GET an unknown record id returns 404, not 500", async ({ request }) => {
  const response = await request.get("/api/v1/records/does-not-exist");
  expect(response.status()).toBe(404);
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
