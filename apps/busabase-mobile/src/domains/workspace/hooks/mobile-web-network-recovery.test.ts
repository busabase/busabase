// @vitest-environment jsdom
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileQueryRecoveryProvider } from "../components/MobileQueryRecoveryProvider";
import { getMobileQueryRecovery, releaseMobileQueryRecovery } from "../utils/mobile-query-recovery";

type Network = { isConnected: boolean | null; isInternetReachable: boolean | null };
const mocks = vi.hoisted(() => ({
  mode: "self-hosted",
  networkListener: undefined as ((network: Network) => void) | undefined,
  fetch: vi.fn<() => Promise<Network>>(),
  refresh: vi.fn<() => Promise<Network>>(),
}));
vi.mock("~/api/use-busabase-orpc", () => ({
  useBusabaseOrpc: () => ({ scopeKey: "web:quiet-netinfo", mode: mocks.mode }),
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: {
    fetch: mocks.fetch,
    refresh: mocks.refresh,
    addEventListener: (listener: (network: Network) => void) => {
      mocks.networkListener = listener;
      return () => {
        mocks.networkListener = undefined;
      };
    },
  },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const scope = "web:quiet-netinfo";
const connected: Network = { isConnected: true, isInternetReachable: true };
const failedInternet: Network = { isConnected: true, isInternetReachable: false };
let root: Root | undefined;
let client: QueryClient;
let stopObserver: (() => void) | undefined;
const originalOnline = Object.getOwnPropertyDescriptor(navigator, "onLine");
const setOnline = (online: boolean) =>
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
const browserEvent = (online: boolean) =>
  act(() => {
    setOnline(online);
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });

beforeEach(() => {
  mocks.mode = "self-hosted";
  mocks.fetch.mockReset().mockResolvedValue(connected);
  mocks.refresh.mockReset().mockResolvedValue(connected);
  mocks.networkListener = undefined;
  setOnline(true);
  onlineManager.setOnline(true);
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
    },
  });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  stopObserver?.();
  stopObserver = undefined;
  releaseMobileQueryRecovery(client, scope);
  client.clear();
  onlineManager.setOnline(true);
  if (originalOnline) Object.defineProperty(navigator, "onLine", originalOnline);
  else Reflect.deleteProperty(navigator, "onLine");
  vi.restoreAllMocks();
});
const mount = async () => {
  await act(async () => {
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MobileQueryRecoveryProvider, null, null),
      ),
    );
    await Promise.resolve();
  });
};

it("refreshes a visible calendar after real window offline/online signals when NetInfo stays quiet", async () => {
  const key = [scope, "base-calendar-range", "base-a", "preview"];
  let serverTitle = "Before";
  const read = vi.fn(async () => serverTitle);
  client.setQueryData(key, "Before");
  const observer = new QueryObserver(client, { queryKey: key, queryFn: read, staleTime: Infinity });
  stopObserver = observer.subscribe(() => undefined);
  const recovery = getMobileQueryRecovery(client, scope);
  recovery.registerRoute(Symbol("calendar"), [key]);
  await mount();
  expect(read).not.toHaveBeenCalled();

  // No networkListener callback: reproduces Chromium's unchanged
  // navigator.connection object while its standard offline event still fires.
  browserEvent(false);
  expect(onlineManager.isOnline()).toBe(false);
  expect(recovery.isAvailable()).toBe(false);
  serverTitle = "After";
  expect(client.getQueryData(key)).toBe("Before");
  expect(read).not.toHaveBeenCalled();

  browserEvent(true);
  await vi.waitFor(() => expect(client.getQueryData(key)).toBe("After"));
  expect(read).toHaveBeenCalledTimes(1);
  expect(recovery.isAvailable()).toBe(true);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("never lets stale NetInfo callbacks mark an offline browser connected", async () => {
  let resolve!: (network: Network) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise<Network>((done) => {
      resolve = done;
    }),
  );
  await mount();
  browserEvent(false);
  act(() => mocks.networkListener?.(connected));
  await act(async () => {
    resolve(connected);
    await Promise.resolve();
  });
  expect(onlineManager.isOnline()).toBe(false);
  expect(getMobileQueryRecovery(client, scope).isAvailable()).toBe(false);
});

it("retains Cloud's explicit failed internet probe until NetInfo reports recovery", async () => {
  mocks.mode = "cloud";
  mocks.refresh.mockResolvedValue(failedInternet);
  await mount();
  act(() => mocks.networkListener?.(failedInternet));
  browserEvent(false);
  browserEvent(true);
  await act(async () => {
    await Promise.resolve();
  });
  expect(onlineManager.isOnline()).toBe(false);
  act(() => mocks.networkListener?.(connected));
  expect(onlineManager.isOnline()).toBe(true);
});

it("removes both browser listeners and ignores a refresh resolving after unmount", async () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  let resolve!: (network: Network) => void;
  mocks.refresh.mockReturnValueOnce(
    new Promise<Network>((done) => {
      resolve = done;
    }),
  );
  await mount();
  const handler = add.mock.calls.find(
    ([name, listener]) =>
      name === "offline" &&
      typeof listener === "function" &&
      listener.name === "updateBrowserNetwork",
  )?.[1];
  expect(handler).toBeDefined();
  browserEvent(false);
  browserEvent(true);
  await act(async () => root?.unmount());
  root = undefined;
  expect(remove).toHaveBeenCalledWith("online", handler);
  expect(remove).toHaveBeenCalledWith("offline", handler);
  onlineManager.setOnline(false);
  await act(async () => {
    resolve(connected);
    await Promise.resolve();
  });
  expect(onlineManager.isOnline()).toBe(false);
  browserEvent(false);
  browserEvent(true);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
