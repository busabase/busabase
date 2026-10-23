import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const proxy = {
    activePorts: vi.fn(() => [3174]),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    setWatermark: vi.fn(),
  };
  const createProcess = () => {
    let complete!: (result: { exitCode: number; stderr: string; stdout: string }) => void;
    const completion = new Promise<{ exitCode: number; stderr: string; stdout: string }>(
      (resolve) => {
        complete = resolve;
      },
    );
    return { complete, completion, kill: vi.fn(), on: vi.fn() };
  };
  let process = createProcess();
  const nodepod = {
    instanceId: "pod-restart",
    port: vi.fn((port: number) =>
      port === 3174 ? "https://busabase.test/__virtual__/pod-restart/3174" : null,
    ),
    proxy,
    setPreviewScript: vi.fn(),
    snapshot: vi.fn(() => ({ entries: [] as unknown[] })),
    spawn: vi.fn(async () => process),
    teardown: vi.fn(),
  };
  return {
    createProcess,
    get process() {
      return process;
    },
    listeners,
    nodepod,
    proxy,
    resetProcess() {
      process = createProcess();
    },
  };
});

vi.mock("@r1ck404/nodepod", () => ({
  Nodepod: { boot: vi.fn(async () => mocks.nodepod) },
}));

vi.mock("../src/domains/airapp/utils/nodepod-service-worker", () => ({
  beginPodHeartbeat: vi.fn(() => vi.fn()),
  ensureRegistered: vi.fn(),
}));

import { Nodepod } from "@r1ck404/nodepod";
import {
  dependencyCacheKey,
  loadCachedDependencies,
  storeCachedDependencies,
} from "../src/domains/airapp/components/runners/dependency-cache";
import { NodepodRunner } from "../src/domains/airapp/components/runners/nodepod-runner";
import { createFakeCacheStorage } from "./helpers/fake-cache-storage";

describe("NodepodRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listeners.clear();
    mocks.resetProcess();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // On localhost, upstream's default previewOrigin ("auto") waits up to 10s
  // for a bridge document we do not serve before falling back to the path URL.
  it("boots with path-URL previews so localhost starts skip the bridge wait", async () => {
    const runner = new NodepodRunner();
    await runner.mount({
      "package.json": JSON.stringify({ scripts: { dev: "node server.js" } }),
      "server.js": "// test",
    });

    expect(Nodepod.boot).toHaveBeenCalledWith(expect.objectContaining({ previewOrigin: false }));

    runner.dispose();
  });

  it("recovers an already-listening preview port when server-ready was missed", async () => {
    const runner = new NodepodRunner();
    const onReady = vi.fn();
    runner.onReady(onReady);

    await runner.mount({
      "package.json": JSON.stringify({ scripts: { dev: "node server.js" } }),
      "server.js": "// test",
    });
    const started = runner.start();
    await vi.advanceTimersByTimeAsync(100);
    await started;

    expect(mocks.proxy.activePorts).toHaveBeenCalledWith("pod-restart");
    expect(onReady).toHaveBeenCalledWith("https://busabase.test/__virtual__/pod-restart/3174");

    runner.dispose();
  });

  it("rejects when the dev process exits before opening a preview port", async () => {
    mocks.proxy.activePorts.mockReturnValueOnce([]);
    const runner = new NodepodRunner();
    await runner.mount({
      "package.json": JSON.stringify({ scripts: { dev: "node server.js" } }),
      "server.js": "// test",
    });

    const started = runner.start();
    mocks.process.complete({
      exitCode: 1,
      stderr: "Cannot find module './missing.js'",
      stdout: "",
    });

    await expect(started).rejects.toThrow(
      "Dev server exited with code 1 before opening a preview port: Cannot find module './missing.js'",
    );
    runner.dispose();
  });

  describe("dependency cache", () => {
    const appFiles = {
      "package.json": JSON.stringify({
        scripts: { dev: "node server.js" },
        dependencies: { hono: "^4.12.29" },
      }),
      "server.js": "// test",
    };
    const plan = { runtime: "node", install: "npm install" } as const;
    let fake: ReturnType<typeof createFakeCacheStorage>;

    beforeEach(() => {
      fake = createFakeCacheStorage();
      vi.stubGlobal("caches", fake.storage);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("installs on a miss, then caches the node_modules the install wrote", async () => {
      mocks.nodepod.snapshot.mockReturnValueOnce({
        entries: [
          { path: "/server.js", kind: "file", data: btoa("// test") },
          { path: "/node_modules/hono/index.js", kind: "file", data: btoa("export {}") },
        ],
      });
      const runner = new NodepodRunner();
      await runner.mount(appFiles);
      const installed = runner.install();
      await vi.waitFor(() => expect(mocks.nodepod.spawn).toHaveBeenCalledWith("npm", ["install"]));
      mocks.process.complete({ exitCode: 0, stderr: "", stdout: "" });
      await installed;

      expect(mocks.nodepod.snapshot).toHaveBeenCalledWith({ shallow: false });
      const key = await dependencyCacheKey(appFiles, plan);
      await vi.waitFor(() => expect(fake.entries.has(key as string)).toBe(true));
      const cached = await loadCachedDependencies(key as string);
      expect(Object.keys(cached ?? {})).toEqual(["node_modules/hono/index.js"]);
      runner.dispose();
    });

    it("mounts cached node_modules with the app's files and skips the install on a hit", async () => {
      const key = await dependencyCacheKey(appFiles, plan);
      await storeCachedDependencies(key as string, {
        "node_modules/hono/index.js": new TextEncoder().encode("export {}"),
      });
      const logs: string[] = [];
      const runner = new NodepodRunner();
      runner.onLog((line) => logs.push(line));
      await runner.mount(appFiles);

      const bootFiles = vi.mocked(Nodepod.boot).mock.calls[0][0]?.files ?? {};
      expect(Object.keys(bootFiles).sort()).toEqual([
        "node_modules/hono/index.js",
        "package.json",
        "server.js",
      ]);
      await runner.install();
      expect(mocks.nodepod.spawn).not.toHaveBeenCalled();
      expect(logs.join("")).toContain("Restored 1 dependency files from this device's cache");
      runner.dispose();
    });

    it("drops cached dependencies the app cannot start from", async () => {
      const key = await dependencyCacheKey(appFiles, plan);
      await storeCachedDependencies(key as string, {
        "node_modules/hono/index.js": new TextEncoder().encode("broken"),
      });
      mocks.proxy.activePorts.mockReturnValueOnce([]);
      const runner = new NodepodRunner();
      await runner.mount(appFiles);
      await runner.install();
      const started = runner.start();
      await vi.waitFor(() => expect(mocks.nodepod.spawn).toHaveBeenCalled());
      mocks.process.complete({ exitCode: 1, stderr: "SyntaxError", stdout: "" });

      await expect(started).rejects.toThrow("Dev server exited with code 1");
      await vi.waitFor(() => expect(fake.cache.delete).toHaveBeenCalledWith(key));
      expect(await loadCachedDependencies(key as string)).toBeNull();
      runner.dispose();
    });
  });
});
