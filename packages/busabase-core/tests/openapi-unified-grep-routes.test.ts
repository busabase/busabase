import { describe, expect, it } from "vitest";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";

/**
 * Permanent regression coverage for the Unified Grep (P2a) OpenAPI surface —
 * the top-level `POST /grep` route declared in
 * packages/busabase-contract/src/contract/busabase.ts (nothing to change
 * there — this test only verifies the generator faithfully turns that
 * declaration into a public /api/v1 spec, mirroring
 * `openapi-drive-grep-routes.test.ts`'s pattern for `assets.grep`). See
 * apps/busabase/content/spec/unified-grep.md.
 */

type OpenApiOperation = {
  tags?: string[];
  summary?: string;
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
};

type OpenApiPathItem = Record<string, OpenApiOperation>;

describe("Busabase OpenAPI Unified Grep route", () => {
  it("exposes POST /api/v1/grep", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;

    const pathItem = paths["/api/v1/grep"];
    expect(pathItem, "missing OpenAPI path /api/v1/grep").toBeDefined();
    expect(pathItem?.post, "missing POST /api/v1/grep").toBeDefined();
  });

  it("tags the route with a non-empty summary", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;

    const operation = paths["/api/v1/grep"]?.post;
    expect(operation?.tags).toContain("Search");
    expect(typeof operation?.summary === "string" && operation.summary.length > 0).toBe(true);
  });

  it("has a non-empty request body schema", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;

    const schema = paths["/api/v1/grep"]?.post?.requestBody?.content?.["application/json"]?.schema;
    expect(schema, "POST /api/v1/grep should declare a request body schema").toBeTruthy();
    expect(Object.keys(schema as Record<string, unknown>).length).toBeGreaterThan(0);
  });

  it("has a non-empty output (VO) schema", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;

    const schema =
      paths["/api/v1/grep"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;
    expect(schema, "POST /api/v1/grep should declare a 200 response schema").toBeTruthy();
    expect(Object.keys(schema as Record<string, unknown>).length).toBeGreaterThan(0);
  });
});
