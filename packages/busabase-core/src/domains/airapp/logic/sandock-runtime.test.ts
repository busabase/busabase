import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Orchestration tests for the Sandock engine.
 *
 * These exercise the *sequence* — provision, upload, install, background the
 * dev server, expose a port, tear down — against a recording stand-in for the
 * Sandock API. They verify everything Busabase itself decides; the opt-in
 * integration test next door separately verifies the same orchestration and
 * signed Preview hop against a real Sandock Cloud deployment.
 */

interface Call {
  op: string;
  args: Record<string, unknown>;
}

let calls: Call[] = [];
let shellResults: Array<{
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: number;
  timedOut?: boolean;
}> = [];
let clientOptions: Array<{ baseUrl?: string; headers?: Record<string, string> }> = [];
let fetchMock: ReturnType<typeof vi.fn>;
let createdSandboxes = 0;

const envelope = <T>(data: T) => ({ success: true, code: 0, message: "ok", data });

/** Shaped after the published `sandock` SDK's `SandockClient` namespaces. */
const api = {
  sandbox: {
    create: vi.fn(async (options: Record<string, unknown>) => {
      calls.push({ op: "create", args: options });
      createdSandboxes += 1;
      return envelope({ id: `sbx_${createdSandboxes}` });
    }),
    start: vi.fn(async (id: string) => {
      calls.push({ op: "start", args: { id } });
      return envelope({ id, started: true });
    }),
    stop: vi.fn(async (id: string) => {
      calls.push({ op: "stop", args: { id } });
      return envelope({ id, stopped: true });
    }),
    delete: vi.fn(async (id: string) => {
      calls.push({ op: "delete", args: { id } });
      return envelope({ id, deleted: true });
    }),
    revokePreviewToken: vi.fn(async (id: string, token: string) => {
      calls.push({ op: "revokePreviewToken", args: { id, token } });
      return { success: true as const };
    }),
    shell: vi.fn(async (id: string, options: Record<string, unknown>) => {
      calls.push({ op: "shell", args: { id, ...options } });
      const next = shellResults.shift() ?? {};
      return envelope({
        stdout: next.stdout ?? "",
        stderr: next.stderr ?? "",
        exitCode: next.exitCode ?? 0,
        timedOut: false,
        durationMs: 1,
      });
    }),
    getSignedPreviewUrl: vi.fn(async (id: string, options: Record<string, unknown>) => {
      calls.push({ op: "signedPreviewUrl", args: { id, ...options } });
      return envelope({ url: "https://3000-tok.sandock.ai" });
    }),
  },
  fs: {
    write: vi.fn(async (id: string, path: string, content: string) => {
      calls.push({ op: "writeFile", args: { id, path, content } });
      return envelope(true);
    }),
  },
};

vi.mock("sandock", () => ({
  createSandockClient: vi.fn((options: { baseUrl?: string; headers?: Record<string, string> }) => {
    clientOptions.push(options);
    return api;
  }),
}));

const registered: Array<[string, string, string]> = [];
const unregistered: Array<[string, string]> = [];
vi.mock("./local-preview-registry", () => ({
  registerLocalPreview: (nodeId: string, owner: string, target: string) => {
    registered.push([nodeId, owner, target]);
  },
  unregisterLocalPreview: (nodeId: string, owner: string) => {
    unregistered.push([nodeId, owner]);
  },
}));

const NODE_FILES = { "package.json": JSON.stringify({ scripts: { dev: "node server.js" } }) };

const drainUntilReady = async (
  gen: AsyncGenerator<AirAppRuntimeEvent>,
): Promise<AirAppRuntimeEvent[]> => {
  const events: AirAppRuntimeEvent[] = [];
  for (let i = 0; i < 40; i += 1) {
    const next = await gen.next();
    if (next.done) break;
    events.push(next.value);
    if (next.value.type === "ready" || next.value.type === "error") break;
  }
  return events;
};

let mod: typeof import("./sandock-runtime");

beforeEach(async () => {
  process.env.SANDOCK_BASE_URL = "https://sandock.example";
  process.env.SANDOCK_API_KEY = "key_test";
  mod = await import("./sandock-runtime");
  await mod.__resetSandockRuntimeForTest();
  calls = [];
  shellResults = [];
  clientOptions = [];
  createdSandboxes = 0;
  registered.length = 0;
  unregistered.length = 0;
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response("ready", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await mod.__resetSandockRuntimeForTest();
  delete process.env.SANDOCK_BASE_URL;
  delete process.env.SANDOCK_API_KEY;
  delete process.env.SANDOCK_SPACE_ID;
  delete process.env.SANDOCK_IMAGE;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("resolveSandockConfig", () => {
  it("treats Sandock as available when configured, not when the deployment is cloud", () => {
    expect(
      mod.resolveSandockConfig({
        SANDOCK_BASE_URL: "https://sandock.example/",
        SANDOCK_API_KEY: "k",
      }),
    ).toEqual({
      baseUrl: "https://sandock.example",
      apiKey: "k",
      spaceId: undefined,
      image: undefined,
    });
  });

  it("uses the Sandock Cloud origin when the API key is the only configured value", () => {
    expect(mod.resolveSandockConfig({ SANDOCK_API_KEY: "k" })).toEqual({
      baseUrl: "https://sandock.ai",
      apiKey: "k",
      spaceId: undefined,
      image: undefined,
    });
  });

  it("accepts an optional target space without making it part of availability", () => {
    expect(
      mod.resolveSandockConfig({
        SANDOCK_BASE_URL: "https://sandock.example",
        SANDOCK_API_KEY: "k",
        SANDOCK_SPACE_ID: "  space-1  ",
      }),
    ).toEqual({
      baseUrl: "https://sandock.example",
      apiKey: "k",
      spaceId: "space-1",
      image: undefined,
    });
  });

  it("is unavailable only when the API key is empty", () => {
    expect(mod.resolveSandockConfig({ SANDOCK_BASE_URL: "https://sandock.example" })).toBeNull();
    expect(mod.resolveSandockConfig({ SANDOCK_API_KEY: "  " })).toBeNull();
    expect(
      mod.resolveSandockConfig({ SANDOCK_BASE_URL: "  ", SANDOCK_API_KEY: "k" })?.baseUrl,
    ).toBe("https://sandock.ai");
  });

  it("requires an HTTP(S) origin rather than an arbitrary URL", () => {
    for (const baseUrl of [
      "sandock.example",
      "ftp://sandock.example",
      "https://sandock.example/api/v1",
      "https://sandock.example?tenant=1",
      "https://user:secret@sandock.example",
    ]) {
      expect(
        mod.resolveSandockConfig({ SANDOCK_BASE_URL: baseUrl, SANDOCK_API_KEY: "k" }),
        baseUrl,
      ).toBeNull();
    }
    expect(
      mod.resolveSandockConfig({
        SANDOCK_BASE_URL: "http://localhost:3070/",
        SANDOCK_API_KEY: "k",
      })?.baseUrl,
    ).toBe("http://localhost:3070");
    expect(
      mod.resolveSandockConfig({
        SANDOCK_BASE_URL: "https://SANDOCK.EXAMPLE:443",
        SANDOCK_API_KEY: "k",
      })?.baseUrl,
    ).toBe("https://sandock.example");
  });
});

describe("runAirAppSandock", () => {
  it("says so plainly when the engine is not configured", async () => {
    delete process.env.SANDOCK_API_KEY;
    const events = await drainUntilReady(
      mod.runAirAppSandock({ nodeId: "n1", files: NODE_FILES, owner: "u1" }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
    expect((events[0] as { message: string }).message).toContain("SANDOCK_API_KEY");
    // Nothing was provisioned, so there is nothing to bill for.
    expect(calls).toHaveLength(0);
  });

  it("provisions, uploads, installs, backgrounds the server and exposes the port", async () => {
    shellResults = [
      {}, // mkdir
      { stdout: "added 1 package\n" }, // install
      {}, // background start
    ];
    const events = await drainUntilReady(
      mod.runAirAppSandock({ nodeId: "n1", files: NODE_FILES, owner: "u1" }),
    );

    expect(calls.map((c) => c.op)).toEqual([
      "create",
      "start",
      "shell", // mkdir
      "writeFile",
      "shell", // install
      "shell", // background the dev server
      "signedPreviewUrl",
    ]);

    // The container has to outlive its entrypoint, or there is nothing to exec into.
    expect(calls[0]?.args.command).toEqual(["/bin/sh", "-c", "sleep infinity"]);
    expect(calls[0]?.args.cpu).toBe(500);
    expect(calls[0]?.args.memory).toBe(500);
    // Sandock's own deadline is a backstop that does not depend on Busabase
    // being alive to reap.
    expect(calls[0]?.args.activeDeadlineSeconds).toBeGreaterThan(0);
    // The app is told what it is running under, same as every other engine.
    expect(calls[0]?.args.env).toMatchObject({ BUSABASE_AIRAPP_RUNTIME: "remote" });

    // Node defaults, unchanged — this engine adds no per-language handling.
    const install = calls.find((c) => c.op === "shell" && String(c.args.cmd).includes("npm"));
    expect(install?.args.cmd).toBe("npm install");

    // A dev server never exits, so a foreground `shell` would just hang.
    const start = calls.filter((c) => c.op === "shell").at(-1);
    expect(String(start?.args.cmd)).toContain("setsid");
    expect(String(start?.args.cmd)).toContain("npm run dev");

    expect(events.at(-1)).toEqual({ type: "ready", previewUrl: "/api/airapp-preview/n1/" });
    // Registered as a proxy target so the preview stays same-origin. Pointing
    // the iframe at sandock.ai directly is what would break `/api/v1`.
    expect(registered).toEqual([["n1", "u1", "https://3000-tok.sandock.ai"]]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://3000-tok.sandock.ai",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("waits for the Sandock Preview Proxy to stay stable before exposing the iframe", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("No server on pod/3000", { status: 502 }))
      .mockResolvedValueOnce(new Response("<!doctype html>", { status: 200 }))
      .mockResolvedValueOnce(new Response("No server on pod/3000", { status: 503 }))
      .mockResolvedValueOnce(new Response("<!doctype html>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<!doctype html>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<!doctype html>", { status: 200 }));
    shellResults = [
      {}, // mkdir
      { stdout: "" }, // install
      {}, // background start
      { stdout: "AirApp server listening on port 3000\n" }, // readiness tail
    ];

    const events = await drainUntilReady(
      mod.runAirAppSandock({ nodeId: "n1", files: NODE_FILES, owner: "u1" }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(events).toContainEqual({
      type: "log",
      line: "AirApp server listening on port 3000\n",
    });
    expect(events.at(-1)).toEqual({
      type: "ready",
      previewUrl: "/api/airapp-preview/n1/",
    });
    expect(registered).toEqual([["n1", "u1", "https://3000-tok.sandock.ai"]]);
  });

  it("targets the configured Space through both the client and create request", async () => {
    process.env.SANDOCK_BASE_URL = "https://sandock.example/";
    process.env.SANDOCK_SPACE_ID = "space-1";
    process.env.SANDOCK_IMAGE = "sandock/airapp:node-python";
    shellResults = [{}, { stdout: "" }, {}];
    const controller = new AbortController();
    const gen = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u1" },
      controller.signal,
    );
    await drainUntilReady(gen);

    expect(clientOptions).toEqual([
      {
        baseUrl: "https://sandock.example",
        headers: { authorization: "Bearer key_test", "X-Space-ID": "space-1" },
      },
    ]);
    expect(calls.find((call) => call.op === "create")?.args.spaceId).toBe("space-1");
    expect(calls.find((call) => call.op === "create")?.args.image).toBe(
      "sandock/airapp:node-python",
    );

    controller.abort();
    await gen.return(undefined as never);
  });

  it("revokes, unregisters and stops a ready sandbox without deleting it", async () => {
    shellResults = [{}, { stdout: "" }, {}];
    const controller = new AbortController();
    const gen = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u1" },
      controller.signal,
    );
    await drainUntilReady(gen);
    controller.abort();
    await gen.return(undefined as never);

    expect(calls.map((c) => c.op)).toContain("stop");
    expect(calls.map((c) => c.op)).not.toContain("delete");
    expect(calls.filter((c) => c.op === "revokePreviewToken")).toEqual([
      { op: "revokePreviewToken", args: { id: "sbx_1", token: "tok" } },
    ]);
    expect(unregistered).toEqual([["n1", "u1"]]);
  });

  it("restarts the same stopped sandbox ID and rebuilds its ephemeral app filesystem", async () => {
    shellResults = [{}, { stdout: "installed first\n" }, {}];
    const firstController = new AbortController();
    const first = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u1" },
      firstController.signal,
    );
    await drainUntilReady(first);
    firstController.abort();
    await first.return(undefined as never);

    calls = [];
    shellResults = [
      {}, // reuse probe: true
      {}, // reset app directory
      { stdout: "installed again\n" },
      {}, // background start
    ];
    const secondController = new AbortController();
    const second = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u1" },
      secondController.signal,
    );
    const events = await drainUntilReady(second);

    expect(calls.map((call) => call.op)).not.toContain("create");
    expect(calls.find((call) => call.op === "start")?.args.id).toBe("sbx_1");
    expect(calls.find((call) => call.op === "writeFile")?.args.id).toBe("sbx_1");
    expect(
      calls.some(
        (call) =>
          call.op === "shell" && call.args.id === "sbx_1" && call.args.cmd === "npm install",
      ),
    ).toBe(true);
    expect(events).toContainEqual({ type: "log", line: "installed again\n" });
    expect(events.at(-1)).toEqual({
      type: "ready",
      previewUrl: "/api/airapp-preview/n1/",
    });

    secondController.abort();
    await second.return(undefined as never);
  });

  it("replaces a stopped sandbox when its non-secret Sandock configuration changes", async () => {
    process.env.SANDOCK_SPACE_ID = "space-old";
    process.env.SANDOCK_IMAGE = "image-old";
    shellResults = [{}, {}, {}];
    const firstController = new AbortController();
    const first = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u1" },
      firstController.signal,
    );
    await drainUntilReady(first);
    firstController.abort();
    await first.return(undefined as never);

    calls = [];
    process.env.SANDOCK_SPACE_ID = "space-new";
    process.env.SANDOCK_IMAGE = "image-new";
    shellResults = [{}, {}, {}];
    const secondController = new AbortController();
    const second = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u1" },
      secondController.signal,
    );
    const events = await drainUntilReady(second);

    expect(calls[0]).toEqual({ op: "delete", args: { id: "sbx_1" } });
    expect(calls.some((call) => call.op === "start" && call.args.id === "sbx_1")).toBe(false);
    expect(calls.find((call) => call.op === "create")?.args).toMatchObject({
      spaceId: "space-new",
      image: "image-new",
    });
    expect(calls.find((call) => call.op === "start")?.args.id).toBe("sbx_2");
    expect(events).toContainEqual({
      type: "log",
      line: "[busabase] Sandock configuration changed; provisioning a new sandbox.\n",
    });

    secondController.abort();
    await second.return(undefined as never);
  });

  it("deletes an unavailable cached sandbox and transparently provisions a replacement", async () => {
    shellResults = [{}, {}, {}];
    const firstController = new AbortController();
    const first = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u1" },
      firstController.signal,
    );
    await drainUntilReady(first);
    firstController.abort();
    await first.return(undefined as never);

    calls = [];
    api.sandbox.start.mockRejectedValueOnce(new Error("Sandbox not found"));
    shellResults = [{}, {}, {}];
    const secondController = new AbortController();
    const second = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u1" },
      secondController.signal,
    );
    const events = await drainUntilReady(second);

    expect(api.sandbox.start).toHaveBeenNthCalledWith(2, "sbx_1");
    expect(calls.map((call) => [call.op, call.args.id])).toEqual(
      expect.arrayContaining([
        ["delete", "sbx_1"],
        ["start", "sbx_2"],
      ]),
    );
    expect(calls.map((call) => call.op)).toContain("create");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "log",
        line: expect.stringContaining("provisioning a replacement"),
      }),
    );
    expect(events.at(-1)?.type).toBe("ready");

    secondController.abort();
    await second.return(undefined as never);
  });

  it("does not reuse another owner's stopped sandbox for the same node", async () => {
    shellResults = [{}, {}, {}];
    const firstController = new AbortController();
    const first = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u1" },
      firstController.signal,
    );
    await drainUntilReady(first);
    firstController.abort();
    await first.return(undefined as never);

    calls = [];
    shellResults = [{}, {}, {}];
    const otherController = new AbortController();
    const other = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u2" },
      otherController.signal,
    );
    await drainUntilReady(other);

    expect(calls.map((call) => call.op)).toContain("create");
    expect(calls.find((call) => call.op === "start")?.args.id).toBe("sbx_2");

    otherController.abort();
    await other.return(undefined as never);
  });

  it("deletes cached stopped sandboxes when test state is reset", async () => {
    shellResults = [{}, {}, {}];
    const controller = new AbortController();
    const gen = mod.runAirAppSandock(
      { nodeId: "n1", files: NODE_FILES, owner: "u1" },
      controller.signal,
    );
    await drainUntilReady(gen);
    controller.abort();
    await gen.return(undefined as never);
    expect(calls.map((call) => call.op)).not.toContain("delete");

    await mod.__resetSandockRuntimeForTest();

    expect(calls).toContainEqual({ op: "delete", args: { id: "sbx_1" } });
  });

  it("reports a failed install instead of exposing a port to nothing", async () => {
    shellResults = [{}, { stderr: "ERR!\n", exitCode: 1 }];
    // Drained to completion rather than stopped at the error, because that is
    // how the session layer consumes it — and because abandoning an async
    // generator does not run its `finally`, so a test that broke early would be
    // asserting teardown that a real consumer *would* have got.
    const events: AirAppRuntimeEvent[] = [];
    for await (const event of mod.runAirAppSandock({
      nodeId: "n1",
      files: NODE_FILES,
      owner: "u1",
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(calls.map((c) => c.op)).not.toContain("signedPreviewUrl");
    // And the sandbox is still cleaned up — a failed install must not leave one
    // running to be billed for.
    expect(calls.map((c) => c.op)).toContain("delete");
  });

  it("deletes a sandbox whose detached start command fails", async () => {
    shellResults = [{}, {}, { stderr: "cannot start\n", exitCode: 1 }];
    const events: AirAppRuntimeEvent[] = [];
    for await (const event of mod.runAirAppSandock({
      nodeId: "n1",
      files: NODE_FILES,
      owner: "u1",
    })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "log", line: "cannot start\n" });
    expect(events).toContainEqual({
      type: "error",
      message: "Start failed (exit code 1): cannot start",
    });
    expect(calls.map((call) => call.op)).not.toContain("signedPreviewUrl");
    expect(calls.map((call) => call.op)).toContain("delete");
  });

  it("surfaces structured workspace preparation failures and deletes the sandbox", async () => {
    shellResults = [
      {
        stderr: { reason: "Kubernetes exec unavailable" },
        exitCode: 1,
      },
    ];
    const events: AirAppRuntimeEvent[] = [];
    for await (const event of mod.runAirAppSandock({
      nodeId: "n1",
      files: NODE_FILES,
      owner: "u1",
    })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "error",
      message:
        'AirApp workspace preparation failed (exit code 1): {"reason":"Kubernetes exec unavailable"}',
    });
    expect(calls.map((call) => call.op)).not.toContain("writeFile");
    expect(calls.map((call) => call.op)).toContain("delete");
  });

  it("bounds cleanup retries and reports a sandbox it could not delete", async () => {
    shellResults = [{}, { stderr: "ERR!\n", exitCode: 1 }];
    api.sandbox.stop.mockRejectedValueOnce(new Error("provider offline"));
    api.sandbox.stop.mockRejectedValueOnce(new Error("provider offline"));
    api.sandbox.delete.mockRejectedValueOnce(new Error("provider offline"));
    api.sandbox.delete.mockRejectedValueOnce(new Error("provider offline"));

    const events: AirAppRuntimeEvent[] = [];
    for await (const event of mod.runAirAppSandock({
      nodeId: "n1",
      files: NODE_FILES,
      owner: "u1",
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "error",
      message: expect.stringContaining("Sandock cleanup incomplete for sbx_1"),
    });
    expect(calls.filter((call) => call.op === "stop")).toHaveLength(0);
    expect(api.sandbox.stop).toHaveBeenCalledTimes(2);
    expect(api.sandbox.delete).toHaveBeenCalledTimes(2);
  });

  it("decodes binary files instead of writing bytes through the text API", async () => {
    shellResults = [{}, {}, { stdout: "" }, {}];
    await drainUntilReady(
      mod.runAirAppSandock({
        nodeId: "n1",
        files: NODE_FILES,
        binaryFiles: { "public/logo.png": "AAAA" },
        owner: "u1",
      }),
    );

    // Staged as base64, then decoded in place. Writing the bytes as text would
    // store the file under the right name with the wrong contents.
    const staged = calls.find((c) => c.op === "writeFile" && String(c.args.path).endsWith(".b64"));
    expect(staged).toBeDefined();
    const decode = calls.find((c) => c.op === "shell" && String(c.args.cmd).includes("base64 -d"));
    expect(decode).toBeDefined();
  });
});
