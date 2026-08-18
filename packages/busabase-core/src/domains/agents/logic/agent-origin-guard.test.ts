import { describe, expect, it } from "vitest";
import { checkAgentsRequestOrigin } from "./agent-origin-guard";

const OSS = "http://localhost:15419/api/rpc/agents/sessions/create";

const request = (headers: Record<string, string>, url = OSS) => new Request(url, { headers });

describe("checkAgentsRequestOrigin", () => {
  it("blocks a browser request made from another site", () => {
    // The threat: a page the user happens to visit POSTing to their localhost.
    const verdict = checkAgentsRequestOrigin(
      request({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }),
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/another site/i);
  });

  it("blocks same-site-but-different-origin too (a subdomain is not us)", () => {
    expect(checkAgentsRequestOrigin(request({ "sec-fetch-site": "same-site" })).allowed).toBe(
      false,
    );
  });

  it("allows the app's own page", () => {
    expect(
      checkAgentsRequestOrigin(
        request({ "sec-fetch-site": "same-origin", origin: "http://localhost:15419" }),
      ).allowed,
    ).toBe(true);
  });

  it("allows a tunnel-forwarded request, whose Origin is legitimately Cloud's", () => {
    // Regression for a real 403 (2026-08-17): a Cloud user driving their
    // laptop's agent sends a same-origin request to Cloud, and the relay
    // forwards every header verbatim — so OSS sees Cloud's Origin against its
    // own localhost host. Comparing Origin to the host killed the entire
    // Cloud → tunnel → agents path; Sec-Fetch-Site is the honest verdict.
    const verdict = checkAgentsRequestOrigin(
      request({
        "sec-fetch-site": "same-origin",
        origin: "http://localhost:3060",
        "x-busabase-space": "tnl_5eS7umu1xma4WP6LbowvJ",
      }),
    );

    expect(verdict.allowed).toBe(true);
  });

  it("allows non-browser callers, which send no Sec-Fetch-Site", () => {
    expect(checkAgentsRequestOrigin(request({})).allowed).toBe(true);
  });

  it("allows a directly-typed URL (`none`)", () => {
    expect(checkAgentsRequestOrigin(request({ "sec-fetch-site": "none" })).allowed).toBe(true);
  });

  it("ignores paths that are not agents procedures", () => {
    const verdict = checkAgentsRequestOrigin(
      request({ "sec-fetch-site": "cross-site" }, "http://localhost:15419/api/rpc/nodes/list"),
    );

    // Other endpoints keep the pre-existing open CORS posture on purpose —
    // widening that is a separate change (spec §8.0).
    expect(verdict.allowed).toBe(true);
  });
});
