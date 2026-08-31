import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Orchestration tests for the Sandock engine.
 *
 * These exercise the *sequence* — provision, upload, install, background the
 * dev server, expose a port, tear down — against a recording stand-in for the
 * Sandock API. They deliberately do not claim anything about a real sandbox:
 * no Sandock instance was reachable while writing this, so the network
 * behaviour of the real service is unverified and called out as such in the PR.
 * What is verified is everything Busabase itself decides.
 */

interface Call {
  op: string;
  args: Record<string, unknown>;
}

let calls: Call[] = [];
let shellResults: Array<{ stdout?: string; stderr?: string; exitCode?: number }> = [];

const envelope = <T>(data: T) => ({ success: true, code: 0, message: "ok", data });

/** Shaped after the published `sandock` SDK's `SandockClient` namespaces. */
const api = {
  sandbox: {
    create: vi.fn(async (options: Record<string, unknown>) => {
      calls.push({ op: "create", args: options });
      return envelope({ id: "sbx_1" });
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
  createSandockClient: vi.fn(() => api),
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
  calls = [];
  shellResults = [];
  registered.length = 0;
  unregistered.length = 0;
  vi.clearAllMocks();
  process.env.SANDOCK_BASE_URL = "https://sandock.example";
  process.env.SANDOCK_API_KEY = "key_test";
  mod = await import("./sandock-runtime");
});

afterEach(() => {
  delete process.env.SANDOCK_BASE_URL;
  delete process.env.SANDOCK_API_KEY;
  delete process.env.SANDOCK_IMAGE;
});

describe("resolveSandockConfig", () => {
  it("treats Sandock as available when configured, not when the deployment is cloud", () => {
    expect(mod.resolveSandockConfig({ SANDOCK_BASE_URL: "u", SANDOCK_API_KEY: "k" })).toEqual({
      baseUrl: "u",
      apiKey: "k",
      image: undefined,
    });
  });

  it("is unavailable when either half is missing, rather than half-configured", () => {
    expect(mod.resolveSandockConfig({ SANDOCK_BASE_URL: "u" })).toBeNull();
    expect(mod.resolveSandockConfig({ SANDOCK_API_KEY: "k" })).toBeNull();
    expect(mod.resolveSandockConfig({ SANDOCK_BASE_URL: "  ", SANDOCK_API_KEY: "k" })).toBeNull();
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
    expect((events[0] as { message: string }).message).toContain("SANDOCK_BASE_URL");
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
  });

  it("stops and deletes the sandbox when the run ends", async () => {
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
    expect(calls.map((c) => c.op)).toContain("delete");
    expect(unregistered).toEqual([["n1", "u1"]]);
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
