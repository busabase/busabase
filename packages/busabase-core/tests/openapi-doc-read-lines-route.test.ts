import { describe, expect, it } from "vitest";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";

/**
 * Permanent regression coverage for the Doc-domain `readLines` OpenAPI surface
 * — the Doc equivalent of `assets.readTextLines` (see
 * `tests/openapi-drive-grep-routes.test.ts`, which this mirrors). The route is
 * declared in packages/busabase-contract/src/domains/doc/contract.ts (nothing
 * to change there — this test only verifies the generator faithfully turns
 * that declaration into a public /api/v1 spec).
 */

type OpenApiOperation = {
  tags?: string[];
  summary?: string;
  parameters?: unknown[];
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
};

type OpenApiPathItem = Record<string, OpenApiOperation>;

const PATH = "/api/v1/docs/{nodeId}/lines";
const METHOD = "get";

describe("Busabase OpenAPI Doc readLines route", () => {
  it("exposes GET /api/v1/docs/{nodeId}/lines", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;

    const pathItem = paths[PATH];
    expect(pathItem, `missing OpenAPI path ${PATH}`).toBeDefined();
    expect(pathItem?.[METHOD], `missing GET ${PATH}`).toBeDefined();
  });

  it("tags the route Docs with a non-empty summary", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;
    const operation = paths[PATH]?.[METHOD];

    expect(operation?.tags).toContain("Docs");
    expect(typeof operation?.summary === "string" && operation.summary.length > 0).toBe(true);
  });

  it("declares path/query parameters (GET readLines has no request body)", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;
    const operation = paths[PATH]?.[METHOD];

    expect(operation?.parameters?.length ?? 0).toBeGreaterThan(0);
    const names = (operation?.parameters ?? []).map((param) => (param as { name?: string }).name);
    expect(names).toEqual(expect.arrayContaining(["nodeId", "startLine", "endLine"]));
  });

  it("has a non-empty output (VO) schema", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;
    const operation = paths[PATH]?.[METHOD];
    const successResponse = operation?.responses?.["200"];
    const schema = successResponse?.content?.["application/json"]?.schema;

    expect(schema).toBeTruthy();
    expect(Object.keys(schema as Record<string, unknown>).length).toBeGreaterThan(0);
  });
});
