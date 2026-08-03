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

  it("keeps numbered record pagination in the public contract", async () => {
    const spec = await getBusabaseOpenApiSpec();
    expect(spec.paths?.["/api/v1/records/page"]?.get).toBeDefined();
  });

  it("publishes only the two canonical change-request action paths", async () => {
    const spec = await getBusabaseOpenApiSpec();
    expect(spec.paths?.["/api/v1/change-requests/reviews"]?.post).toBeDefined();
    expect(spec.paths?.["/api/v1/change-requests/merge"]?.post).toBeDefined();
    expect(spec.paths?.["/api/v1/change-requests/{changeRequestId}/reviews"]).toBeUndefined();
    expect(spec.paths?.["/api/v1/change-requests/{changeRequestId}/merge"]).toBeUndefined();
  });

  it("no longer publishes any of the four retired typed list/get pairs", async () => {
    const spec = await getBusabaseOpenApiSpec();
    for (const path of [
      "/api/v1/docs",
      "/api/v1/docs/{nodeId}",
      "/api/v1/files/{nodeId}",
      "/api/v1/folders",
      "/api/v1/folders/{nodeId}",
      "/api/v1/file-trees/{nodeId}",
    ]) {
      expect(spec.paths?.[path]?.get, `${path} GET must be gone`).toBeUndefined();
    }
    // `/api/v1/files` and `/api/v1/file-trees` still exist — as POST-only
    // creation routes. Only their GET twin was retired.
    expect(spec.paths?.["/api/v1/files"]?.get).toBeUndefined();
    expect(spec.paths?.["/api/v1/files"]?.post).toBeDefined();
    expect(spec.paths?.["/api/v1/file-trees"]?.get).toBeUndefined();
    expect(spec.paths?.["/api/v1/file-trees"]?.post).toBeDefined();
  });

  it("serves all four through one unified Node detail route", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const operation = spec.paths?.["/api/v1/nodes/{nodeId}"]?.get;
    expect(operation).toBeDefined();
    const parameterNames = (operation?.parameters ?? [])
      .filter(
        (parameter): parameter is Exclude<typeof parameter, { $ref: string }> =>
          !("$ref" in parameter),
      )
      .map((parameter) => parameter.name)
      .sort();
    expect(parameterNames).toEqual(["nodeId", "type"]);
  });

  it("keeps the literal /nodes GET routes as their own operations", async () => {
    // They share a prefix with the new `/nodes/{nodeId}` template; if either
    // were swallowed by it, quick-jump and favorites would silently 404.
    const spec = await getBusabaseOpenApiSpec();
    expect(spec.paths?.["/api/v1/nodes/search"]?.get).toBeDefined();
    expect(spec.paths?.["/api/v1/nodes/favorites"]?.get).toBeDefined();
  });

  it("serves Base archive and restore through one lifecycle path", async () => {
    const spec = await getBusabaseOpenApiSpec();
    expect(spec.paths?.["/api/v1/bases/{baseId}/lifecycle/change-requests"]?.post).toBeDefined();
    expect(spec.paths?.["/api/v1/bases/{baseId}/archive/change-requests"]).toBeUndefined();
    expect(spec.paths?.["/api/v1/bases/{baseId}/restore/change-requests"]).toBeUndefined();
  });

  it("keeps the compressed public API at 96 operations", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const operationCount = Object.values(spec.paths ?? {}).reduce(
      (count, pathItem) =>
        count +
        Object.keys(pathItem ?? {}).filter((key) =>
          ["get", "post", "put", "patch", "delete", "head", "options"].includes(key),
        ).length,
      0,
    );
    // Numbered pagination raised the merged develop baseline from 104 to 105;
    // consolidating four CR action operations into two brought it to 103.
    // Unified Node detail retired four typed gets and added one (-3 -> 100);
    // unified Node summary lists retired the four typed lists (-4 -> 96).
    // Collapsing Base archive + restore into one lifecycle operation (-1 -> 95).
    // Numbered change request paging for the inbox (+1 -> 96) — the cursor
    // listing stays, since "keep scrolling" and "jump to page 30 of 45" are
    // different jobs and the inbox needs both.
    expect(operationCount).toBe(96);
  });
});
