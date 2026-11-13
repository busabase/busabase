import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  busabaseOpenApiCommonSchemas,
  busabaseOpenApiErrorResponseBodySchema,
  nameBusabaseOpenApiEventSchemas,
} from "busabase-contract/contract/openapi-components";
import { isRpcOnly } from "openlib/openapi";
import { beforeAll, describe, expect, it } from "vitest";

describe("snapshot SSE OpenAPI components", () => {
  let generated: Awaited<ReturnType<OpenAPIGenerator["generate"]>>;
  beforeAll(async () => {
    generated = await new OpenAPIGenerator({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }).generate(busabaseContract, {
      exclude: (contract) => isRpcOnly(contract),
      commonSchemas: busabaseOpenApiCommonSchemas,
      customErrorResponseBodySchema: busabaseOpenApiErrorResponseBodySchema,
    });
  });
  const content = (spec: typeof generated) =>
    (
      spec.paths?.["/api/v1/dump/export/snapshot"]?.post?.responses?.["200"] as {
        content: Record<string, { schema: { oneOf: Array<Record<string, unknown>> } }>;
      }
    ).content;

  it("moves each actual generated envelope intact, including done/error data constraints and optional transport fields", () => {
    const spec = structuredClone(generated),
      before = structuredClone(content(spec)["text/event-stream"].schema.oneOf);
    expect(nameBusabaseOpenApiEventSchemas(spec)).toBe(spec);
    expect(Object.keys(content(spec))).toEqual(["text/event-stream"]);
    const refs = content(spec)["text/event-stream"].schema.oneOf;
    expect(refs).toEqual([
      { $ref: "#/components/schemas/DumpSnapshotMessage" },
      { $ref: "#/components/schemas/DumpSnapshotDone" },
      { $ref: "#/components/schemas/DumpSnapshotError" },
    ]);
    for (const [index, ref] of refs.entries()) {
      const name = String(ref.$ref).replace("#/components/schemas/", "");
      expect(spec.components?.schemas?.[name]).toEqual(before[index]);
    }
    const frozen = JSON.stringify(spec);
    expect(nameBusabaseOpenApiEventSchemas(spec)).toBe(spec);
    expect(JSON.stringify(spec)).toBe(frozen);
  });

  it("refuses an upstream envelope shape change instead of silently weakening its error contract", () => {
    const spec = structuredClone(generated),
      members = content(spec)["text/event-stream"].schema.oneOf;
    members[2].required = ["event", "data"];
    const before = JSON.stringify(spec);
    expect(() => nameBusabaseOpenApiEventSchemas(spec)).toThrow(/variant changed/);
    expect(JSON.stringify(spec)).toBe(before);
  });

  it("leaves additional data constraints intact when the transport field layout is unchanged", () => {
    const spec = structuredClone(generated),
      members = content(spec)["text/event-stream"].schema.oneOf;
    const properties = members[2].properties as Record<string, unknown>;
    properties.data = {
      type: "object",
      required: ["code"],
      properties: { code: { type: "string" } },
      additionalProperties: false,
    };
    const before = structuredClone(members[2]);
    nameBusabaseOpenApiEventSchemas(spec);
    expect(spec.components?.schemas?.DumpSnapshotError).toEqual(before);
  });
});
