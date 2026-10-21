import { busabaseOpenApiCommonSchemas } from "busabase-contract/contract/openapi-components";
import { describe, expect, it } from "vitest";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";

/**
 * The public spec publishes the domain's core types as named, shared
 * `components.schemas` (`busabaseOpenApiCommonSchemas`) instead of inlining
 * them at every use site, so an SDK generated from it gets one `ChangeRequest`
 * model rather than one auto-named copy per operation.
 *
 * oRPC matches components by schema INSTANCE: a contract edit that wraps a
 * registered schema at its use sites (`.extend()`, `.describe()`) silently
 * un-shares it. These assertions catch that, plus dangling refs.
 */

const REF_PREFIX = "#/components/schemas/";

const collectRefs = (node: unknown, refs: string[] = []): string[] => {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") refs.push(value);
      else collectRefs(value, refs);
    }
  }
  return refs;
};

type Responses = Record<string, { content?: Record<string, { schema?: unknown }> }>;

describe("Busabase OpenAPI shared component schemas", () => {
  it("declares OpenAPI 3.1, which is what the generated JSON Schema is", async () => {
    const spec = await getBusabaseOpenApiSpec();
    // `type: "null"`, `const`, and numeric `exclusiveMinimum` are invalid in 3.0.
    expect(spec.openapi).toBe("3.1.1");
  });

  it("publishes every registered component under its name", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const published = Object.keys(spec.components?.schemas ?? {});
    expect(published.sort()).toEqual(Object.keys(busabaseOpenApiCommonSchemas).sort());
  });

  it("resolves every $ref and references every component at least once", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const schemas = spec.components?.schemas ?? {};
    const refs = collectRefs(spec);

    for (const ref of refs) {
      expect(ref.startsWith(REF_PREFIX), ref).toBe(true);
      expect(schemas, `dangling ${ref}`).toHaveProperty(ref.slice(REF_PREFIX.length));
    }
    const referenced = new Set(refs.map((ref) => ref.slice(REF_PREFIX.length)));
    const unreferenced = Object.keys(schemas).filter((name) => !referenced.has(name));
    expect(unreferenced, "registered but never matched — wrapped at its use sites?").toEqual([]);
  });

  it("shares the core VOs instead of inlining them per operation", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const refs = collectRefs(spec.paths);
    const count = (name: string) => refs.filter((ref) => ref === `${REF_PREFIX}${name}`).length;

    expect(count("ChangeRequest")).toBeGreaterThanOrEqual(10);
    expect(count("PendingChangeRequest")).toBeGreaterThanOrEqual(5);
    expect(count("Base")).toBeGreaterThanOrEqual(3);
    expect(count("Record")).toBeGreaterThanOrEqual(3);
    // Inlined, the document was ~1.1 MB; shared, it is ~240 KB.
    expect(JSON.stringify(spec).length).toBeLessThan(500_000);
  });

  it("documents the { error, code, data } envelope the server sends for errors", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const errorResponses = Object.values(spec.paths ?? {}).flatMap((pathItem) =>
      Object.values(pathItem as Record<string, { responses?: Responses }>).flatMap((operation) =>
        Object.entries(operation.responses ?? {})
          .filter(([status]) => !status.startsWith("2"))
          .map(([, response]) => response.content?.["application/json"]?.schema),
      ),
    );

    expect(errorResponses.length).toBeGreaterThan(0);
    for (const schema of errorResponses) {
      expect(schema).toEqual({ $ref: `${REF_PREFIX}Error` });
    }
    expect(spec.components?.schemas?.Error).toMatchObject({
      type: "object",
      required: ["error", "code"],
    });
  });
});
