import { describe, expect, it } from "vitest";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";

/**
 * The published documentation for the record-query parameters.
 *
 * This file exists because of a specific, easy mistake: a `/** … *\/` comment
 * above a zod field documents it for anyone reading the SOURCE and reaches the
 * OpenAPI spec not at all — only `.describe()` does. Every one of these
 * parameters was added with a careful JSDoc block and shipped, to an API
 * consumer, completely undocumented.
 *
 * So these assertions are about the parameters an external caller has to make a
 * decision about, and they check the SUBSTANCE rather than the presence of a
 * string: `valueFilters` is worth using instead of `filters` only if you know
 * it is exact, and `bucketing` is only a meaningful choice if you know the two
 * modes disagree. A description that did not say those things would pass a
 * "has a description" check and still leave the caller guessing.
 */

/**
 * Reads a parameter's documentation from wherever the generator put it.
 *
 * oRPC renders a zod `.describe()` onto the parameter's SCHEMA rather than onto
 * the parameter itself. Both are valid OpenAPI and tools render both, so this
 * looks in both rather than asserting the generator's current choice — the
 * question these tests ask is whether a caller can read it, not which of two
 * equivalent slots it landed in.
 */
const parametersOf = async (route: string) => {
  const spec = await getBusabaseOpenApiSpec();
  const paths = (spec.paths ?? {}) as Record<
    string,
    {
      get?: {
        parameters?: { name?: string; description?: string; schema?: { description?: string } }[];
      };
    }
  >;
  const parameters = paths[route]?.get?.parameters ?? [];
  return new Map(
    parameters.map((parameter) => [
      parameter.name,
      parameter.description ?? parameter.schema?.description ?? "",
    ]),
  );
};

describe("record query parameters are documented in the published spec", () => {
  it("says `valueFilters` is EXACT, which is the whole reason to prefer it over `filters`", async () => {
    for (const route of ["/api/v1/records", "/api/v1/records/count", "/api/v1/records/group-by"]) {
      const described = await parametersOf(route);
      expect(described.get("valueFilters"), route).toMatch(/EXACT/);
    }
  });

  it("says how `valueFilters` fails — a 400, not a dropped condition", async () => {
    const described = await parametersOf("/api/v1/records");
    expect(described.get("valueFilters")).toMatch(/400/);
    // The `any` group is the only way to express an OR, and it is not guessable.
    expect(described.get("valueFilters")).toMatch(/any/);
  });

  it("says the two `bucketing` modes DISAGREE, so the choice reads as a choice", async () => {
    const described = await parametersOf("/api/v1/records/group-by");
    expect(described.get("bucketing")).toMatch(/disagree/i);
    expect(described.get("bucketing")).toMatch(/GROUP BY/);
  });

  it("says an empty aggregate is NULL rather than 0", async () => {
    // The difference a dashboard renders differently, and the one a caller will
    // otherwise discover from a chart.
    const described = await parametersOf("/api/v1/records/group-by");
    expect(described.get("aggregates")).toMatch(/NULL rather than 0/);
  });

  it("says `fieldSlug` may be omitted, which is not guessable from a name", async () => {
    const described = await parametersOf("/api/v1/records/group-by");
    expect(described.get("fieldSlug")).toMatch(/OMIT/);
  });
});
