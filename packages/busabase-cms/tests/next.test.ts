import { describe, expect, it } from "vitest";
import { resolveBusabaseCmsCacheKeyPrefix } from "../src/next";
import type { BusabaseCmsSource } from "../src/source";

describe("Next.js cache isolation", () => {
  it("includes the non-secret Busabase host and space in default cache keys", () => {
    expect(
      resolveBusabaseCmsCacheKeyPrefix(
        {
          config: {
            baseUrl: "https://example.busabase.com/api/v1/",
            apiKey: "must-not-enter-cache-key",
            spaceId: "space-a",
          },
        },
        {},
      ),
    ).toEqual(["busabase-cms", "https://example.busabase.com", "space-a"]);
  });

  it("isolates Folder-managed CMS instances by Folder ID", () => {
    expect(
      resolveBusabaseCmsCacheKeyPrefix(
        {
          folderId: "node-cms-folder",
          config: {
            baseUrl: "https://example.busabase.com",
            spaceId: "space-a",
          },
        },
        {},
      ),
    ).toEqual([
      "busabase-cms",
      "https://example.busabase.com",
      "space-a",
      "node-cms-folder",
      "standard",
    ]);
  });

  it("isolates different schema profiles for the same Folder", () => {
    expect(
      resolveBusabaseCmsCacheKeyPrefix(
        {
          folderId: "node-cms-folder",
          schemaProfile: "buda",
          config: {
            baseUrl: "https://example.busabase.com",
            spaceId: "space-a",
          },
        },
        {},
      ),
    ).toEqual([
      "busabase-cms",
      "https://example.busabase.com",
      "space-a",
      "node-cms-folder",
      "buda",
    ]);
  });

  it("requires an explicit namespace for custom sources", () => {
    const source = {} as BusabaseCmsSource;
    expect(() => resolveBusabaseCmsCacheKeyPrefix({ source }, {})).toThrow(
      "requires cache.keyPrefix",
    );
    expect(
      resolveBusabaseCmsCacheKeyPrefix({ source }, { keyPrefix: ["tenant-a", "cms"] }),
    ).toEqual(["tenant-a", "cms"]);
  });

  it("does not derive cache keys from secret API keys or custom headers", () => {
    expect(() => resolveBusabaseCmsCacheKeyPrefix({ config: { apiKey: "secret" } }, {})).toThrow(
      "target space cannot be represented without secrets",
    );
    expect(() =>
      resolveBusabaseCmsCacheKeyPrefix(
        { config: { headers: { "x-busabase-space": "hidden-space" } } },
        {},
      ),
    ).toThrow("target space cannot be represented without secrets");
  });
});
