// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AirAppBridgeRuntime } from "./airapp-bridge-runtime";

interface RunnerFixture {
  ready?: (url: string) => void;
  mount: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

const runtime = vi.hoisted(() => ({ runners: [] as RunnerFixture[], failMount: false }));
vi.mock("busabase-core/domains/airapp/nodepod-runner", () => ({
  NodepodRunner: class {
    ready?: (url: string) => void;
    mount = vi.fn(async () => {
      if (runtime.failMount) throw new Error("private runner diagnostics");
    });
    install = vi.fn(async () => {});
    start = vi.fn(async () => {});
    dispose = vi.fn();
    constructor() {
      runtime.runners.push(this);
    }
    onReady(callback: (url: string) => void) {
      this.ready = callback;
    }
    onExit() {}
  },
}));

const files = { "package.json": '{"scripts":{"dev":"node server.js"}}' };
const props = {
  bridgeHeaders: { "x-busabase-embed-capability": "fixture-capability" },
  runtimeKind: "embed" as const,
  files,
  labels: { loading: "Loading published app", unavailable: "Content unavailable" },
  title: "Published delivery app",
};

beforeEach(() => {
  runtime.runners.length = 0;
  runtime.failMount = false;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ records: [] })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the public AirApp host using the shared viewport", () => {
  it("keeps its iframe identity and uses its forwarded ref for the credential-free data relay", async () => {
    const { rerender } = render(<AirAppBridgeRuntime {...props} />);
    expect(screen.getByText("Loading published app")).toBeDefined();
    await waitFor(() => expect(runtime.runners[0]?.start).toHaveBeenCalledOnce());
    act(() => runtime.runners[0].ready?.("/__virtual__/fixture/3000"));
    const frame = screen.getByTitle("Published delivery app") as HTMLIFrameElement;
    const post = vi
      .spyOn(frame.contentWindow as Window, "postMessage")
      .mockImplementation(() => {});
    frame.setAttribute("data-local-state", "keep the app running");

    rerender(<AirAppBridgeRuntime {...props} layout="fill" title="Shared delivery app" />);
    expect(screen.getByTitle("Shared delivery app")).toBe(frame);
    expect(frame.getAttribute("data-local-state")).toBe("keep the app running");
    expect(runtime.runners).toHaveLength(1);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin: window.location.origin,
          data: {
            type: "busabase:embed-fetch-request",
            requestId: "fixture-read",
            url: "/api/v1/records?baseId=fixture",
            method: "GET",
            headers: [
              ["cookie", "member-session=do-not-relay"],
              ["authorization", "Bearer do-not-relay"],
            ],
            bodyBase64: "",
          },
        }),
      );
    });
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const relayed = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => !String(url).endsWith("/_status"));
    expect(relayed).toHaveLength(1);
    const [url, init] = relayed[0];
    expect(new URL(String(url)).pathname).toBe("/api/airapp-embed-bridge/api/v1/records");
    expect(init?.credentials).toBe("omit");
    const headers = new Headers(init?.headers);
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-busabase-embed-capability")).toBe("fixture-capability");
    expect(post.mock.calls[0][0]).toMatchObject({
      type: "busabase:embed-fetch-response",
      requestId: "fixture-read",
      status: 200,
    });
  });

  it("uses the host's neutral failure fallback without exposing runner diagnostics", async () => {
    runtime.failMount = true;
    const { unmount } = render(<AirAppBridgeRuntime {...props} />);
    await screen.findByText("Content unavailable");
    expect(screen.queryByTitle("Published delivery app")).toBeNull();
    expect(screen.queryByText("private runner diagnostics")).toBeNull();
    expect(runtime.runners[0].install).not.toHaveBeenCalled();
    unmount();
    expect(runtime.runners[0].dispose).toHaveBeenCalledOnce();
  });
});
