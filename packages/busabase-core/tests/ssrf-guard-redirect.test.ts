import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithSsrfGuard } from "../src/domains/webhook/logic/ssrf-guard";

// Public IP literals pass the guard without a DNS lookup.
const FIRST = "https://93.184.216.34/start";

const redirectTo = (location: string, status = 307) =>
  new Response(null, { status, headers: { location } });

const seen: { url: string; headers: Headers }[] = [];
const stubFetch = (responses: Response[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers) });
      return responses.shift() ?? new Response("ok");
    }),
  );

afterEach(() => {
  seen.length = 0;
  vi.unstubAllGlobals();
});

describe("fetchWithSsrfGuard redirects", () => {
  const init = {
    method: "POST",
    headers: { authorization: "Bearer secret", cookie: "a=1", "x-api-key": "k" },
    body: "{}",
  };

  it("keeps credentials on a redirect within the same origin", async () => {
    stubFetch([redirectTo("/next"), new Response("ok")]);
    await fetchWithSsrfGuard(FIRST, init);
    expect(seen[1]?.url).toBe("https://93.184.216.34/next");
    expect(seen[1]?.headers.get("authorization")).toBe("Bearer secret");
  });

  it("drops Authorization and Cookie when a redirect leaves the origin", async () => {
    stubFetch([redirectTo("https://1.1.1.1/elsewhere"), new Response("ok")]);
    await fetchWithSsrfGuard(FIRST, init);
    expect(seen[1]?.url).toBe("https://1.1.1.1/elsewhere");
    expect(seen[1]?.headers.get("authorization")).toBeNull();
    expect(seen[1]?.headers.get("cookie")).toBeNull();
    // Same rule as fetch: other headers are the author's to choose.
    expect(seen[1]?.headers.get("x-api-key")).toBe("k");
  });
});
