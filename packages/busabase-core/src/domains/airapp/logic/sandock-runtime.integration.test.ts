/**
 * Drives the Sandock engine against a **real** Sandock server.
 *
 * The unit tests next door assert the orchestration against a recording
 * stand-in, which proves what Busabase decides but nothing about whether the
 * API accepts it. This closes that gap for everything `apps/sandock` serves —
 * provision, upload, install, background the dev server, tear down — using its
 * LOCAL provider, so no Docker and no credentials are needed.
 *
 * The local mode deliberately stops before `signedPreviewUrl`, which lives in
 * the cloud contract. Supplying the three `AIRAPP_SANDOCK_CLOUD_*` variables
 * instead exercises that remaining hop against Sandock Cloud, including a real
 * preview response and teardown.
 *
 * Run with a server on :3070 —
 *   PG_DATABASE_URL=pglite://memory:// SANDBOX_PROVIDER=LOCAL pnpm --dir apps/sandock start
 *   AIRAPP_SANDOCK_URL=http://localhost:3070 vitest run …
 */

import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const LIVE_URL = process.env.AIRAPP_SANDOCK_URL;
const CLOUD_URL = process.env.AIRAPP_SANDOCK_CLOUD_URL;
const CLOUD_API_KEY = process.env.AIRAPP_SANDOCK_CLOUD_API_KEY;
const CLOUD_SPACE_ID = process.env.AIRAPP_SANDOCK_CLOUD_SPACE_ID;
const CLOUD_ENABLED = Boolean(CLOUD_URL && CLOUD_API_KEY && CLOUD_SPACE_ID);

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

const CLOUD_NODE_FILES = {
  "airapp.json": JSON.stringify({
    runtime: "node",
    install: `node -e "console.log('nothing to install')"`,
    start: "node server.js",
    port: 8392,
  }),
  "server.js": `const { createServer } = require("node:http");
createServer((request, response) => {
  if (request.url === "/api/v1/probe") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ runtime: "node" }));
    return;
  }
  response.setHeader("content-type", "text/html");
  response.end("<h1>Busabase Node Cloud preview</h1>");
}).listen(Number(process.env.PORT), "0.0.0.0");`,
};

const CLOUD_PYTHON_FILES = {
  "airapp.json": JSON.stringify({
    runtime: "python",
    install: `python3 -c "print('nothing to install')"`,
    start: "python3 server.py",
    port: 8393,
  }),
  "server.py": `import http.server
import os

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h1>Busabase Python Cloud preview</h1>")

http.server.ThreadingHTTPServer(("0.0.0.0", int(os.environ["PORT"])), Handler).serve_forever()
`,
};

let previous: { url?: string; key?: string; spaceId?: string };

beforeAll(() => {
  previous = {
    url: process.env.SANDOCK_BASE_URL,
    key: process.env.SANDOCK_API_KEY,
    spaceId: process.env.SANDOCK_SPACE_ID,
  };
  if (LIVE_URL) {
    process.env.SANDOCK_BASE_URL = LIVE_URL;
    // apps/sandock is single-tenant and unauthenticated; the value is ignored
    // but the engine requires one to consider itself configured.
    process.env.SANDOCK_API_KEY = "local-dev";
  } else if (CLOUD_ENABLED) {
    process.env.SANDOCK_BASE_URL = CLOUD_URL;
    process.env.SANDOCK_API_KEY = CLOUD_API_KEY;
    process.env.SANDOCK_SPACE_ID = CLOUD_SPACE_ID;
  }
});

afterAll(async () => {
  try {
    if (LIVE_URL || CLOUD_ENABLED) {
      const { __resetSandockRuntimeForTest } = await import("./sandock-runtime");
      await __resetSandockRuntimeForTest();
    }
  } finally {
    if (previous.url === undefined) delete process.env.SANDOCK_BASE_URL;
    else process.env.SANDOCK_BASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SANDOCK_API_KEY;
    else process.env.SANDOCK_API_KEY = previous.key;
    if (previous.spaceId === undefined) delete process.env.SANDOCK_SPACE_ID;
    else process.env.SANDOCK_SPACE_ID = previous.spaceId;
  }
});

const waitForPreview = async (target: string): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(target);
      if (response.ok) return response;
      lastError = new Error(`Preview returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw lastError;
};

interface CloudRunResult {
  events: AirAppRuntimeEvent[];
  html: string;
  target: string;
  probeBody?: unknown;
}

interface CloudRun {
  ready: () => Promise<CloudRunResult>;
  stop: () => Promise<void>;
}

const eventLog = (events: AirAppRuntimeEvent[]): string =>
  events
    .filter((event): event is { type: "log"; line: string } => event.type === "log")
    .map((event) => event.line)
    .join("");

const createCloudRun = (
  nodeId: string,
  files: Record<string, string>,
  probePath?: string,
  owner = `${nodeId}-owner`,
): CloudRun => {
  const controller = new AbortController();
  const events: AirAppRuntimeEvent[] = [];
  const registrationStart = registered.length;
  let gen: AsyncGenerator<AirAppRuntimeEvent> | null = null;
  let stopped = false;

  return {
    ready: async () => {
      const { runAirAppSandock } = await import("./sandock-runtime");
      gen = runAirAppSandock({ nodeId, files, owner }, controller.signal);
      for (let i = 0; i < 60; i += 1) {
        const next = await gen.next();
        if (next.done) break;
        events.push(next.value);
        if (next.value.type === "ready" || next.value.type === "error") break;
      }
      const error = events.find(
        (event): event is { type: "error"; message: string } => event.type === "error",
      );
      expect(error?.message, eventLog(events)).toBeUndefined();
      const target = registered
        .slice(registrationStart)
        .find(
          ([registeredNodeId, registeredOwner]) =>
            registeredNodeId === nodeId && registeredOwner === owner,
        )?.[2];
      expect(target).toBeDefined();
      const previewResponse = await waitForPreview(target as string);
      const html = await previewResponse.text();
      const probeBody = probePath
        ? await (await fetch(new URL(probePath, target as string))).json()
        : undefined;
      return { events, html, target: target as string, probeBody };
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      if (!gen) return;
      let returned = await gen.return(undefined as never);
      // A cleanup failure is yielded as a user-visible error before the
      // generator finishes. Resume so this test cannot suspend a finalizer and
      // leave a billable sandbox behind.
      while (!returned.done) returned = await gen.return(undefined as never);
    },
  };
};

const runCloudApp = async (
  nodeId: string,
  files: Record<string, string>,
  probePath?: string,
): Promise<CloudRunResult> => {
  const run = createCloudRun(nodeId, files, probePath);
  try {
    return await run.ready();
  } finally {
    await run.stop();
  }
};

describe.skipIf(!CLOUD_ENABLED)("runAirAppSandock — against Sandock Cloud", () => {
  it("runs Node and Python previews, then restarts the same stopped Python sandbox", async () => {
    const nodeRun = await runCloudApp("sandock-cloud-node", CLOUD_NODE_FILES, "/api/v1/probe");
    expect(nodeRun.events).toContainEqual({
      type: "ready",
      previewUrl: "/api/airapp-preview/sandock-cloud-node/",
    });
    expect(nodeRun.html).toContain("Busabase Node Cloud preview");
    expect(nodeRun.probeBody).toEqual({ runtime: "node" });

    const pythonRun = await runCloudApp("sandock-cloud-python", CLOUD_PYTHON_FILES);
    expect(pythonRun.events).toContainEqual({
      type: "ready",
      previewUrl: "/api/airapp-preview/sandock-cloud-python/",
    });
    expect(pythonRun.html).toContain("Busabase Python Cloud preview");

    const reusedPythonRun = await runCloudApp("sandock-cloud-python", CLOUD_PYTHON_FILES);
    expect(eventLog(reusedPythonRun.events)).toContain("restarting Sandock sandbox");
    expect(reusedPythonRun.html).toContain("Busabase Python Cloud preview");
  }, 300_000);

  it("keeps concurrent runs of the same AirApp isolated by owner", async () => {
    const first = createCloudRun(
      "sandock-cloud-shared-node",
      CLOUD_NODE_FILES,
      "/api/v1/probe",
      "cloud-user-a",
    );
    const second = createCloudRun(
      "sandock-cloud-shared-node",
      CLOUD_NODE_FILES,
      "/api/v1/probe",
      "cloud-user-b",
    );

    try {
      const [firstReady, secondReady] = await Promise.all([first.ready(), second.ready()]);
      expect(firstReady.target).not.toBe(secondReady.target);
      expect(firstReady.html).toContain("Busabase Node Cloud preview");
      expect(secondReady.html).toContain("Busabase Node Cloud preview");
      expect(firstReady.probeBody).toEqual({ runtime: "node" });
      expect(secondReady.probeBody).toEqual({ runtime: "node" });
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  }, 300_000);
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
    expect(failure?.message).toBe("Failed to get signed preview URL: Not Found");
    expect(registered, "no preview target is registered without a preview URL").toHaveLength(0);
  }, 180_000);
});
