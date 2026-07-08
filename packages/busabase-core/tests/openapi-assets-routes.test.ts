import { describe, expect, it } from "vitest";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";

describe("Busabase OpenAPI asset upload routes", () => {
  it("exposes asset uploads and FileNode routes without legacy attachment upload routes", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = Object.keys(spec.paths ?? {});

    expect(paths).toContain("/api/v1/assets/upload-urls");
    expect(paths).toContain("/api/v1/assets/confirmations");
    expect(paths).toContain("/api/v1/assets/{assetId}/metadata");
    expect(paths).toContain("/api/v1/files");
    expect(paths).toContain("/api/v1/files/{nodeId}");
    expect(paths.filter((path) => path.startsWith("/api/v1/attachments"))).toEqual([]);
  });

  it("documents FileNode creation through the Node Change Request schema", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const serialized = JSON.stringify(spec.paths?.["/api/v1/nodes/change-requests"] ?? {});

    expect(serialized).toContain('"nodeType"');
    expect(serialized).toContain('"file"');
    expect(serialized).toContain('"metadata"');
  });

  it("documents Asset metadata as a first-class public write API", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const serialized = JSON.stringify(spec.paths?.["/api/v1/assets/{assetId}/metadata"] ?? {});

    expect(serialized).toContain('"patch"');
    expect(serialized).toContain('"metadata"');
    expect(serialized).toContain('"mode"');
    expect(serialized).toContain('"Assets"');
  });
});
