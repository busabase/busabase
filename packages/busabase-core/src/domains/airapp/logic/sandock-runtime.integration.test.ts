/**
 * Drives the Sandock engine against a **real** Sandock server.
 *
 * The unit tests next door assert the orchestration against a recording
 * stand-in, which proves what Busabase decides but nothing about whether the
 * API accepts it. This closes that gap for everything `apps/sandock` serves —
 * provision, upload, install, background the dev server, tear down — using its
 * LOCAL provider, so no Docker and no credentials are needed.
 *
 * `signedPreviewUrl` is deliberately out of reach here: it lives in the *cloud*
 * contract, and `apps/sandock` serves only the base one. So the preview-URL hop
 * remains unverified against a real service, and the test says so rather than
 * quietly stopping short.
 *
 * Run with a server on :3070 —
 *   PG_DATABASE_URL=pglite://memory:// SANDBOX_PROVIDER=LOCAL pnpm --dir apps/sandock start
 *   AIRAPP_SANDOCK_URL=http://localhost:3070 vitest run …
 */

import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const LIVE_URL = process.env.AIRAPP_SANDOCK_URL;

const registered: Array<[string, string, string]> = [];
vi.mock("./local-preview-registry", () => ({
  registerLocalPreview: (nodeId: string, owner: string, target: string) => {
    registered.push([nodeId, owner, target]);
  },
  unregisterLocalPreview: () => undefined,
}));

/** A dependency-free app, so the install step needs no network of its own. */
const FILES = {
  "airapp.json": JSON.stringify({
    runtime: "python",
    install: "python3 -c \"print('nothing to install')\"",
    start: "python3 -m http.server $PORT",
    port: 8391,
  }),
  "index.html": "<h1>sandock says hello</h1>",
};

let previous: { url?: string; key?: string };

beforeAll(() => {
  previous = { url: process.env.SANDOCK_BASE_URL, key: process.env.SANDOCK_API_KEY };
  if (LIVE_URL) {
    process.env.SANDOCK_BASE_URL = LIVE_URL;
    // apps/sandock is single-tenant and unauthenticated; the value is ignored
    // but the engine requires one to consider itself configured.
    process.env.SANDOCK_API_KEY = "local-dev";
  }
});

afterAll(() => {
  if (previous.url === undefined) delete process.env.SANDOCK_BASE_URL;
  else process.env.SANDOCK_BASE_URL = previous.url;
  if (previous.key === undefined) delete process.env.SANDOCK_API_KEY;
  else process.env.SANDOCK_API_KEY = previous.key;
});

describe.skipIf(!LIVE_URL)("runAirAppSandock — against a live Sandock", () => {
  it("provisions a real sandbox, uploads the app and installs it", async () => {
    const { runAirAppSandock } = await import("./sandock-runtime");

    const controller = new AbortController();
    const events: AirAppRuntimeEvent[] = [];
    const gen = runAirAppSandock(
      { nodeId: "sandock-live", files: FILES, owner: "live-owner" },
      controller.signal,
    );

    try {
      for (let i = 0; i < 60; i += 1) {
        const next = await gen.next();
        if (next.done) break;
        events.push(next.value);
        if (next.value.type === "ready" || next.value.type === "error") break;
      }
    } finally {
      controller.abort();
      await gen.return(undefined as never);
    }

    const log = events
      .filter((event): event is { type: "log"; line: string } => event.type === "log")
      .map((event) => event.line)
      .join("");

    // A real sandbox was provisioned, the app was uploaded into it, and the
    // install command ran *there* — "nothing to install" is stdout coming back
    // out of the container, not something this process printed.
    expect(log).toContain('runtime "python" declared in airapp.json');
    expect(log).toContain("provisioning a sandbox");
    expect(log).toContain("nothing to install");
    expect(events.some((event) => event.type === "installed")).toBe(true);

    // And the start command was issued with `$PORT` already substituted.
    expect(log).toContain("python3 -m http.server 8391");

    // Where this necessarily stops: `signedPreviewUrl` is a *cloud*-contract
    // procedure and `apps/sandock` serves only the base one, so the run ends
    // with a 404 from that hop. Asserted explicitly rather than tolerated — if
    // it ever changes shape, this should fail and be looked at, and nobody
    // should read this test as covering the preview URL.
    const failure = events.find(
      (event): event is { type: "error"; message: string } => event.type === "error",
    );
    expect(failure?.message).toBe("Not Found");
    expect(registered, "no preview target is registered without a preview URL").toHaveLength(0);
  }, 180_000);
});
