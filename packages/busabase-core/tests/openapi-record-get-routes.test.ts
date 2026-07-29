import { describe, expect, it } from "vitest";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";

describe("Busabase OpenAPI record get route", () => {
  it("publishes one get-one operation with both selector modes", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = spec.paths ?? {};
    const operation = paths["/api/v1/records/get"]?.get;
    const parameters = (operation?.parameters ?? []).filter(
      (parameter): parameter is Exclude<typeof parameter, { $ref: string }> =>
        !("$ref" in parameter),
    );
    const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));

    expect(operation).toBeDefined();
    expect([...byName.keys()].sort()).toEqual(["baseId", "fieldSlug", "recordId", "valueText"]);
    expect(operation?.description).toContain("exactly one selector");
    expect(byName.get("recordId")?.schema).toEqual(
      expect.objectContaining({ description: expect.stringContaining("Use alone") }),
    );
    expect(byName.get("baseId")?.schema).toEqual(
      expect.objectContaining({ description: expect.stringContaining("Requires fieldSlug") }),
    );
    expect(operation?.responses).toHaveProperty("400");
    expect(operation?.responses).toHaveProperty("404");
  });

  it("does not publish either retired get-one path", async () => {
    const spec = await getBusabaseOpenApiSpec();
    expect(spec.paths?.["/api/v1/records/{recordId}"]).toBeUndefined();
    expect(spec.paths?.["/api/v1/records/by-field"]).toBeUndefined();
  });

  it("keeps the compressed public API at 104 operations", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const operationCount = Object.values(spec.paths ?? {}).reduce(
      (count, pathItem) =>
        count +
        Object.keys(pathItem ?? {}).filter((key) =>
          ["get", "post", "put", "patch", "delete", "head", "options"].includes(key),
        ).length,
      0,
    );
    expect(operationCount).toBe(104);
  });
});
