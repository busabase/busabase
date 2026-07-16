import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for `packages/busabase-core/src/domains/airapp/logic/local-node-runtime.ts`
 * — the sandboxed npm install/dev execution engine backing the `"local-node"`
 * AirApp runner. This file previously had zero test coverage. Real sandboxed
 * process spawning is never exercised here (that's covered separately by
 * live/manual verification); instead `@anthropic-ai/sandbox-runtime` and
 * `node:child_process`'s `spawn` are mocked so the pure/logic pieces
 * (port detection, workdir isolation, file writing, sandbox config shape,
 * the concurrency mutex, and the fail-open warning path) are tested in
 * isolation, matching this repo's `tests/text-cache-local-streaming.test.ts`
 * style (real fs for fs-touching code, `vi.mock` for external deps).
 */

describe("detectPort", () => {
  it("matches 'listening on port 4123'", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-node-runtime");
    expect(detectPort("Server listening on port 4123")).toBe(4123);
  });

  it("matches 'localhost:3000'", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-node-runtime");
    expect(detectPort("ready - started server on http://localhost:3000")).toBe(3000);
  });

  it("matches '0.0.0.0:8080'", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-node-runtime");
    expect(detectPort("Listening on 0.0.0.0:8080")).toBe(8080);
  });

  it("matches 'listening on: 5000' (colon variant)", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-node-runtime");
    expect(detectPort("App listening on: 5000")).toBe(5000);
  });

  it("does not match a line with no port info", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-node-runtime");
    expect(detectPort("Compiling...")).toBeNull();
  });

  it("does not match a nonsense out-of-range number", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-node-runtime");
    expect(detectPort("build id 99999999")).toBeNull();
  });

  it("returns null for garbage input", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-node-runtime");
    expect(detectPort("")).toBeNull();
    expect(detectPort("asdkjfh 987 !!! %%")).toBeNull();
  });

  it("matches Vite's real-world 'Local: http://localhost:5173/' format", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-node-runtime");
    expect(detectPort("  ➜  Local:   http://localhost:5173/")).toBe(5173);
  });
});

describe("resolveWorkdir", () => {
  const originalEnv = process.env.SANDAGENT_WORKDIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SANDAGENT_WORKDIR;
    } else {
      process.env.SANDAGENT_WORKDIR = originalEnv;
    }
  });

  it("returns a path rooted under SANDAGENT_WORKDIR/airapp-runtime/{nodeId}/{uuid}", async () => {
    process.env.SANDAGENT_WORKDIR = ".tmp-test-workdir";
    const { resolveWorkdir } = await import("../src/domains/airapp/logic/local-node-runtime");
    const workdir = resolveWorkdir("node-123");
    const expectedBase = path.resolve(
      process.cwd(),
      ".tmp-test-workdir",
      "airapp-runtime",
      "node-123",
    );
    expect(workdir.startsWith(expectedBase + path.sep)).toBe(true);
  });

  it("falls back to '.tmp' when SANDAGENT_WORKDIR is unset", async () => {
    delete process.env.SANDAGENT_WORKDIR;
    const { resolveWorkdir } = await import("../src/domains/airapp/logic/local-node-runtime");
    const workdir = resolveWorkdir("node-123");
    const expectedBase = path.resolve(process.cwd(), ".tmp", "airapp-runtime", "node-123");
    expect(workdir.startsWith(expectedBase + path.sep)).toBe(true);
  });

  it("returns a DIFFERENT path on each call for the same nodeId (Run again must not reuse a stale workdir)", async () => {
    const { resolveWorkdir } = await import("../src/domains/airapp/logic/local-node-runtime");
    const first = resolveWorkdir("same-node");
    const second = resolveWorkdir("same-node");
    expect(first).not.toBe(second);
  });
});

describe("writeFiles", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("creates nested parent directories for a deep file path", async () => {
    const { writeFiles } = await import("../src/domains/airapp/logic/local-node-runtime");
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "airapp-writefiles-"));
    await writeFiles(tmpDir, { "src/components/App.tsx": "export const App = () => null;" });
    const content = await readFile(path.join(tmpDir, "src/components/App.tsx"), "utf-8");
    expect(content).toBe("export const App = () => null;");
  });

  it("writes multiple files at different depths with correct content", async () => {
    const { writeFiles } = await import("../src/domains/airapp/logic/local-node-runtime");
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "airapp-writefiles-"));
    const files = {
      "package.json": '{"name":"demo"}',
      "src/index.ts": "console.log('hi');",
      "src/lib/deep/nested/util.ts": "export const x = 1;",
    };
    await writeFiles(tmpDir, files);
    for (const [filePath, expectedContent] of Object.entries(files)) {
      const actual = await readFile(path.join(tmpDir, filePath), "utf-8");
      expect(actual).toBe(expectedContent);
    }
  });

  it("does not throw and leaves no stray state for an empty files object", async () => {
    const { writeFiles } = await import("../src/domains/airapp/logic/local-node-runtime");
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "airapp-writefiles-"));
    await expect(writeFiles(tmpDir, {})).resolves.toBeUndefined();
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(tmpDir));
    expect(entries).toEqual([]);
  });
});

describe("buildSandboxConfig", () => {
  it("scopes allowWrite to exactly the workdir, denies sensitive read paths, and allow-lists npm registry with no denied domains", async () => {
    const { buildSandboxConfig } = await import("../src/domains/airapp/logic/local-node-runtime");
    const workdir = "/tmp/some-airapp-workdir";
    const config = buildSandboxConfig(workdir);

    expect(config.filesystem.allowWrite).toEqual([workdir]);
    expect(config.filesystem.denyRead).toContain("~/.ssh");
    expect(config.filesystem.denyRead).toContain("~/.aws");
    expect(config.network.allowedDomains).toContain("registry.npmjs.org");
    expect(config.network.deniedDomains).toEqual([]);
  });
});

describe("acquireSandboxLock", () => {
  it("serializes concurrent acquisitions: the second caller does not resolve until the first releases", async () => {
    const { acquireSandboxLock } = await import("../src/domains/airapp/logic/local-node-runtime");

    const release1 = await acquireSandboxLock();

    let secondResolved = false;
    const second = acquireSandboxLock().then((release2) => {
      secondResolved = true;
      return release2;
    });

    // Flush microtasks; the second acquisition must still be pending.
    await Promise.race([second.then(() => undefined), new Promise<void>((r) => setTimeout(r, 20))]);
    expect(secondResolved).toBe(false);

    release1();

    const release2 = await second;
    expect(secondResolved).toBe(true);
    release2();
  });
});

describe("runAirAppLocalNode — fail-open sandboxing-unsupported warning path", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@anthropic-ai/sandbox-runtime");
    vi.doUnmock("node:child_process");
  });

  it("surfaces a 'sandboxing' warning log as the first event and still proceeds with the run", async () => {
    vi.resetModules();

    vi.doMock("@anthropic-ai/sandbox-runtime", () => ({
      SandboxManager: {
        checkDependencies: () => ({ errors: ["socat not installed"], warnings: [] }),
        isSupportedPlatform: () => true,
        initialize: vi.fn(async () => undefined),
        wrapWithSandboxArgv: vi.fn(async (_command: string) => ({
          argv: ["node", "-e", ""],
          env: {},
        })),
        cleanupAfterCommand: vi.fn(() => undefined),
        reset: vi.fn(async () => undefined),
      },
    }));

    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
        };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        // Emit exit asynchronously so listeners are attached first.
        setTimeout(() => {
          child.emit("exit", 0);
        }, 0);
        return child;
      }),
    }));

    const { runAirAppLocalNode } = await import("../src/domains/airapp/logic/local-node-runtime");

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    for await (const event of runAirAppLocalNode({ nodeId: "test-node", files: {} })) {
      events.push(event as { type: string; [key: string]: unknown });
    }

    expect(events.length).toBeGreaterThan(0);
    const first = events[0];
    expect(first.type).toBe("log");
    expect(String(first.line)).toMatch(/sandboxing/i);
    expect(String(first.line)).toMatch(/socat not installed/i);

    // The run proceeds (fail-open) rather than hard-failing: it should reach
    // at least the "installed" stage after the warning.
    expect(events.some((e) => e.type === "installed")).toBe(true);
  });
});
