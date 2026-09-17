import { describe, expect, it } from "vitest";
import { decodeAgentRouteSlug } from "./agent-route-slug";

describe("canonical Agent route identity", () => {
  it("decodes Cloud canonical routes without changing plain Desktop slugs", () => {
    expect(decodeAgentRouteSlug("buda%3Aagt_example")).toBe("buda:agt_example");
    expect(decodeAgentRouteSlug("buda")).toBe("buda");
    expect(decodeAgentRouteSlug("buda:agt_example")).toBe("buda:agt_example");
  });
  it("does not crash on malformed URL encoding", () => {
    expect(decodeAgentRouteSlug("bad%slug")).toBe("bad%slug");
  });
});
