import { describe, expect, it } from "vitest";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";

/**
 * Permanent regression coverage for the Drive Grep Retrieval OpenAPI surface.
 * The 4 routes below are declared in packages/busabase-contract/src/domains/assets/contract.ts
 * (nothing to change there — this test only verifies the generator faithfully
 * turns those declarations into a public /api/v1 spec). See
 * apps/busabase/content/spec/drive-grep-retrieval.md for the feature design.
 */

type OpenApiOperation = {
  tags?: string[];
  summary?: string;
  parameters?: unknown[];
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
};

type OpenApiPathItem = Record<string, OpenApiOperation>;

const DRIVE_GREP_ROUTES: Array<{
  path: string;
  method: "put" | "post" | "get";
  hasRequestBody: boolean;
}> = [
  { path: "/api/v1/assets/{assetId}/text", method: "put", hasRequestBody: true },
  { path: "/api/v1/assets/text/upload-urls", method: "post", hasRequestBody: true },
  { path: "/api/v1/assets/grep", method: "post", hasRequestBody: true },
  { path: "/api/v1/assets/{assetId}/text/lines", method: "get", hasRequestBody: false },
];

describe("Busabase OpenAPI Drive Grep Retrieval routes", () => {
  it("exposes putText, createTextUploadUrl, grep, and readTextLines at the expected paths and HTTP methods", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;

    for (const { path, method } of DRIVE_GREP_ROUTES) {
      const pathItem = paths[path];
      expect(pathItem, `missing OpenAPI path ${path}`).toBeDefined();
      expect(pathItem?.[method], `missing ${method.toUpperCase()} ${path}`).toBeDefined();
    }
  });

  it("tags every Drive Grep Retrieval route Assets with a non-empty summary", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;

    for (const { path, method } of DRIVE_GREP_ROUTES) {
      const operation = paths[path]?.[method];
      expect(operation?.tags, `${method.toUpperCase()} ${path} tags`).toContain("Assets");
      expect(
        typeof operation?.summary === "string" && operation.summary.length > 0,
        `${method.toUpperCase()} ${path} should have a non-empty summary`,
      ).toBe(true);
    }
  });

  it("has a non-empty input schema (body or query/path params) for every Drive Grep Retrieval route", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;

    for (const { path, method, hasRequestBody } of DRIVE_GREP_ROUTES) {
      const operation = paths[path]?.[method];
      if (hasRequestBody) {
        const schema = operation?.requestBody?.content?.["application/json"]?.schema;
        expect(
          schema,
          `${method.toUpperCase()} ${path} should declare a request body schema`,
        ).toBeTruthy();
        expect(
          Object.keys(schema as Record<string, unknown>).length,
          `${method.toUpperCase()} ${path} request body schema should not be empty/z.any()`,
        ).toBeGreaterThan(0);
      } else {
        // GET readTextLines has no body — its input arrives as path + query parameters instead.
        expect(
          operation?.parameters?.length,
          `${method.toUpperCase()} ${path} should declare path/query parameters`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("has a non-empty output (VO) schema for every Drive Grep Retrieval route", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = (spec.paths ?? {}) as Record<string, OpenApiPathItem>;

    for (const { path, method } of DRIVE_GREP_ROUTES) {
      const operation = paths[path]?.[method];
      const successResponse = operation?.responses?.["200"];
      const schema = successResponse?.content?.["application/json"]?.schema;
      expect(
        schema,
        `${method.toUpperCase()} ${path} should declare a 200 response schema`,
      ).toBeTruthy();
      expect(
        Object.keys(schema as Record<string, unknown>).length,
        `${method.toUpperCase()} ${path} response schema should not be empty/z.any()`,
      ).toBeGreaterThan(0);
    }
  });

  it("regression: updateMetadata's description no longer says 'extracted text' (Drive Grep Retrieval wording fix)", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const serialized = JSON.stringify(spec.paths?.["/api/v1/assets/{assetId}/metadata"] ?? {});

    expect(serialized).not.toContain("extracted text");
  });
});
