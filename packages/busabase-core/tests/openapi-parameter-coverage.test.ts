import { describe, expect, it } from "vitest";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";

/**
 * Every published query parameter carries documentation.
 *
 * This is a RULE rather than a count, because a count would be satisfied by
 * filling the gap with noise. A `/** … *\/` comment above a zod field documents
 * it for a source reader and reaches the spec not at all — only `.describe()`
 * does — so a new parameter arrives undocumented by default, and its author
 * usually believes otherwise because they wrote a comment.
 *
 * PATH parameters are deliberately exempt. `assetId` in `/assets/{assetId}` has
 * nothing to say that its name and its position do not already say, and
 * "The asset id." is worse than silence: it makes the gap look closed. Where a
 * path parameter DOES carry a fact — `nodeId` accepting a slug as well as an
 * id — it is documented, it just is not required to be.
 */

const queryParameters = async () => {
  const spec = await getBusabaseOpenApiSpec();
  const paths = (spec.paths ?? {}) as Record<
    string,
    Record<
      string,
      { parameters?: { name?: string; description?: string; schema?: { description?: string } }[] }
    >
  >;
  const found: { route: string; method: string; name: string; described: boolean }[] = [];
  for (const [route, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      for (const parameter of operation?.parameters ?? []) {
        // A parameter interpolated into the path is an identity, not a knob.
        if (!parameter.name || route.includes(`{${parameter.name}}`)) continue;
        found.push({
          route,
          method,
          name: parameter.name,
          described: Boolean(parameter.description ?? parameter.schema?.description),
        });
      }
    }
  }
  return found;
};

describe("published OpenAPI parameters", () => {
  it("documents every query parameter", async () => {
    const undocumented = (await queryParameters())
      .filter((parameter) => !parameter.described)
      .map(
        (parameter) => `${parameter.method.toUpperCase()} ${parameter.route} :: ${parameter.name}`,
      );
    expect(undocumented).toEqual([]);
  });

  it("actually has query parameters to check, so the rule above cannot pass vacuously", async () => {
    // If a refactor stopped emitting parameters, the assertion above would go
    // green by describing nothing at all.
    expect((await queryParameters()).length).toBeGreaterThan(60);
  });
});
