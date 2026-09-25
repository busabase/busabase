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

vi.mock("@scelar/nodepod", () => ({
  Nodepod: { boot: vi.fn(async () => mocks.nodepod) },
}));

vi.mock("../src/domains/airapp/utils/nodepod-service-worker", () => ({
  beginPodHeartbeat: vi.fn(() => vi.fn()),
  ensureRegistered: vi.fn(),
}));

import { NodepodRunner } from "../src/domains/airapp/components/runners/nodepod-runner";

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
});
