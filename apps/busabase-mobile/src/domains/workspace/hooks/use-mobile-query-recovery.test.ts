// @vitest-environment jsdom

import { onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileQueryRecoveryProvider } from "../components/MobileQueryRecoveryProvider";
import { getMobileQueryRecovery, releaseMobileQueryRecovery } from "../utils/mobile-query-recovery";
import { useMobileQueryRecovery } from "./use-mobile-query-recovery";

type Network = { isConnected: boolean | null; isInternetReachable: boolean | null };
const mocks = vi.hoisted(() => ({
  client: null as QueryClient | null,
  scopeKey: "mobile:scope-a",
  mode: "cloud",
  appState: "active",
  appListener: undefined as ((state: string) => void) | undefined,
  networkListener: undefined as ((network: Network) => void) | undefined,
  focusEffect: undefined as (() => (() => void) | undefined) | undefined,
  fetch: vi.fn<() => Promise<Network>>(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => mocks.client,
}));
vi.mock("~/api/use-busabase-orpc", () => ({
  useBusabaseOrpc: () => ({ scopeKey: mocks.scopeKey, mode: mocks.mode }),
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: {
    fetch: mocks.fetch,
    addEventListener: (listener: (network: Network) => void) => {
      mocks.networkListener = listener;
      return () => {
        if (mocks.networkListener === listener) mocks.networkListener = undefined;
      };
    },
  },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    get currentState() {
      return mocks.appState;
    },
    addEventListener: (_: string, listener: (state: string) => void) => {
      mocks.appListener = listener;
      return {
        remove: () => {
          if (mocks.appListener === listener) mocks.appListener = undefined;
        },
      };
    },
  },
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => (() => void) | undefined) => {
    mocks.focusEffect = callback;
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let client: QueryClient;
const connected = { isConnected: true, isInternetReachable: true };
const offline = { isConnected: false, isInternetReachable: false };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.scopeKey = "mobile:scope-a";
  mocks.mode = "cloud";
  mocks.appState = "active";
  mocks.fetch.mockReset().mockResolvedValue(connected);
  mocks.appListener = undefined;
  mocks.networkListener = undefined;
  mocks.focusEffect = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.client = client;
  root = createRoot(document.createElement("div"));
  onlineManager.setOnline(true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  releaseMobileQueryRecovery(client, "mobile:scope-a");
  releaseMobileQueryRecovery(client, "mobile:scope-b");
  client.clear();
  onlineManager.setOnline(true);
});

function renderProvider(strict = false) {
  const provider = createElement(MobileQueryRecoveryProvider, null, null);
  act(() => root.render(strict ? createElement(StrictMode, null, provider) : provider));
}

it("ignores an old network fetch after changing workspace scope", async () => {
  const first = deferred<Network>();
  mocks.fetch.mockReturnValueOnce(first.promise);
  renderProvider();
  mocks.scopeKey = "mobile:scope-b";
  renderProvider();
  await act(async () => {
    first.resolve(offline);
    await first.promise;
    await Promise.resolve();
  });
  expect(onlineManager.isOnline()).toBe(true);
  expect(getMobileQueryRecovery(client, mocks.scopeKey).isAvailable()).toBe(true);
});

it("keeps a newer network event when an older fetch resolves afterwards", async () => {
  const first = deferred<Network>();
  mocks.fetch.mockReturnValueOnce(first.promise);
  renderProvider();
  act(() => mocks.networkListener?.(connected));
  await act(async () => {
    first.resolve(offline);
    await first.promise;
  });
  expect(onlineManager.isOnline()).toBe(true);
  expect(getMobileQueryRecovery(client, mocks.scopeKey).isAvailable()).toBe(true);
});

it("allows a self-hosted LAN connection when the internet probe fails", () => {
  mocks.mode = "self-hosted";
  renderProvider();
  act(() => mocks.networkListener?.({ isConnected: true, isInternetReachable: false }));
  expect(onlineManager.isOnline()).toBe(true);
  expect(getMobileQueryRecovery(client, mocks.scopeKey).isAvailable()).toBe(true);
  act(() => mocks.networkListener?.(offline));
  expect(onlineManager.isOnline()).toBe(false);
  expect(getMobileQueryRecovery(client, mocks.scopeKey).isAvailable()).toBe(false);
});

it("still treats a failed internet probe as offline for Cloud", () => {
  renderProvider();
  act(() => mocks.networkListener?.({ isConnected: true, isInternetReachable: false }));
  expect(onlineManager.isOnline()).toBe(false);
  expect(getMobileQueryRecovery(client, mocks.scopeKey).isAvailable()).toBe(false);
});

it("survives StrictMode effect cleanup and reattachment without cancelling its recovery", async () => {
  renderProvider(true);
  await act(async () => Promise.resolve());
  expect(getMobileQueryRecovery(client, mocks.scopeKey).isAvailable()).toBe(true);
  act(() => mocks.appListener?.("background"));
  expect(getMobileQueryRecovery(client, mocks.scopeKey).isAvailable()).toBe(false);
  act(() => mocks.appListener?.("active"));
  expect(getMobileQueryRecovery(client, mocks.scopeKey).isAvailable()).toBe(true);
});

it("registers first focus without a duplicate read and refreshes a retained screen on return", async () => {
  const queryKey = [mocks.scopeKey, "base-records", "base-a"];
  const queryFn = vi.fn(async () => "After");
  client.setQueryData(queryKey, "Before");
  const observer = new QueryObserver(client, { queryKey, queryFn, staleTime: Infinity });
  const stop = observer.subscribe(() => undefined);
  const Harness = () => {
    useMobileQueryRecovery([queryKey]);
    return null;
  };
  act(() => root.render(createElement(Harness)));
  let leave: (() => void) | undefined;
  act(() => {
    leave = mocks.focusEffect?.();
  });
  await act(async () => Promise.resolve());
  expect(queryFn).not.toHaveBeenCalled();
  act(() => leave?.());
  act(() => {
    leave = mocks.focusEffect?.();
  });
  await act(async () => Promise.resolve());
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(queryKey)).toBe("After");
  act(() => leave?.());
  stop();
});
