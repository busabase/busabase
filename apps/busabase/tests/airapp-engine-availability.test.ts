import { describe, expect, it } from "vitest";
import { resolveBusabaseAirAppEngines } from "~/app/dashboard/airapp-engine-availability";

describe("OSS AirApp engine availability", () => {
  it("offers only Nodepod when Sandock is not configured", () => {
    expect(resolveBusabaseAirAppEngines({ NODE_ENV: "test" })).toEqual(["browser"]);
  });

  it("adds Sandock for a valid configuration without exposing local execution", () => {
    const engines = resolveBusabaseAirAppEngines({
      NODE_ENV: "test",
      SANDOCK_BASE_URL: "https://sandock.example",
      SANDOCK_API_KEY: "test-key",
    });

    expect(engines).toEqual(["browser", "remote"]);
    expect(engines).not.toContain("local");
  });
});
