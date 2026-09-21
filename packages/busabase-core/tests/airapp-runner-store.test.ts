import { afterEach, describe, expect, it, vi } from "vitest";
import type { AirAppRunner } from "../src/domains/airapp/components/runners/types";
import { useAirAppRunnerStore } from "../src/domains/airapp/store/airapp-runner-store";

const createRunner = (): AirAppRunner => ({
  mount: vi.fn(),
  install: vi.fn(),
  start: vi.fn(),
  onLog: vi.fn(),
  onReady: vi.fn(),
  dispose: vi.fn(),
});

describe("airapp runner store", () => {
  afterEach(() => {
    useAirAppRunnerStore.setState({ entries: {}, selectedKinds: {} });
  });

  it("ignores late writes from a superseded run", () => {
    const nodeId = "airapp-1";
    const firstRunner = createRunner();
    const currentRunner = createRunner();
    const store = useAirAppRunnerStore.getState();

    store.beginRun(nodeId, firstRunner, "browser");
    store.beginRun(nodeId, currentRunner, "browser");

    store.setError(nodeId, firstRunner, "CancelledError");
    store.setStatus(nodeId, firstRunner, "installing");
    store.appendLog(nodeId, firstRunner, "stale log");
    store.setPreviewUrl(nodeId, firstRunner, "/stale-preview");

    expect(firstRunner.dispose).toHaveBeenCalledOnce();
    expect(useAirAppRunnerStore.getState().entries[nodeId]).toMatchObject({
      status: "loading-files",
      error: null,
      logLines: [],
      previewUrl: null,
      runner: currentRunner,
    });

    store.setStatus(nodeId, currentRunner, "installing");
    store.appendLog(nodeId, currentRunner, "current log");
    store.setPreviewUrl(nodeId, currentRunner, "/current-preview");

    expect(useAirAppRunnerStore.getState().entries[nodeId]).toMatchObject({
      status: "ready",
      error: null,
      logLines: ["current log"],
      previewUrl: "/current-preview",
      runner: currentRunner,
    });
  });

  it("tracks a Service Worker capability error and clears it before the next run", () => {
    const nodeId = "airapp-service-worker";
    const failedRunner = createRunner();
    const retryRunner = createRunner();
    const store = useAirAppRunnerStore.getState();

    store.beginRun(nodeId, failedRunner, "browser");
    store.setError(
      nodeId,
      failedRunner,
      "Service Worker unavailable",
      "SERVICE_WORKER_UNAVAILABLE",
    );

    expect(useAirAppRunnerStore.getState().entries[nodeId]).toMatchObject({
      status: "error",
      errorCode: "SERVICE_WORKER_UNAVAILABLE",
    });

    store.beginRun(nodeId, retryRunner, "browser");

    expect(useAirAppRunnerStore.getState().entries[nodeId]).toMatchObject({
      status: "loading-files",
      error: null,
      errorCode: null,
      runner: retryRunner,
    });
  });
});
