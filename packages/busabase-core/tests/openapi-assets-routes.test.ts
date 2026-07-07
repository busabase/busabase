import { describe, expect, it } from "vitest";
import { getBusabaseOpenApiSpec } from "../src/openapi/spec";

describe("Busabase OpenAPI asset upload routes", () => {
  it("exposes asset uploads without legacy attachment upload routes", async () => {
    const spec = await getBusabaseOpenApiSpec();
    const paths = Object.keys(spec.paths ?? {});

    expect(paths).toContain("/api/v1/assets/upload-urls");
    expect(paths).toContain("/api/v1/assets/confirmations");
    expect(paths.filter((path) => path.startsWith("/api/v1/attachments"))).toEqual([]);
  });
});
