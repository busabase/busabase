import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginPodHeartbeat,
  ensureRegistered,
  isPodActive,
  isPodHostPath,
  releaseOnHostPage,
} from "../src/domains/airapp/utils/nodepod-service-worker";

/**
 * Nodepod registers its service worker at `scope: "/"`, so one AirApp run
 * leaves the whole origin — marketing site included — controlled by it. These
 * cover the lifetime scoping we put around that: release it where no pod can
 * live, keep it where one can, and put it back before the next boot.
 */

type FakeRegistration = {
  active: { scriptURL: string } | null;
  waiting: null;
  installing: null;
  unregister: () => Promise<boolean>;
};

const makeRegistration = (scriptURL: string): FakeRegistration => ({
  active: { scriptURL },
  waiting: null,
  installing: null,
  unregister: vi.fn(async () => true),
});

const installFakeStorage = () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
};

const installFakeServiceWorker = (registrations: FakeRegistration[]) => {
  const register = vi.fn(async (url: string) => makeRegistration(`https://app.test${url}`));
  const container = {
    controller: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getRegistrations: vi.fn(async () => registrations),
    getRegistration: vi.fn(async () => registrations[0]),
    register,
    ready: Promise.resolve({}),
  };
  vi.stubGlobal("navigator", { serviceWorker: container });
  return container;
};

beforeEach(() => {
  installFakeStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isPodHostPath", () => {
  it("keeps the SW on routes that can run a pod", () => {
    for (const p of [
      "/dashboard",
      "/dashboard/space/base",
      "/embed/abc123/airapp",
      "/__virtual__/inst/3000",
      "/__preview__/inst/3000/",
    ]) {
      expect(isPodHostPath(p), p).toBe(true);
    }
  });

  it("treats marketing and docs routes as pod-free", () => {
    for (const p of ["/", "/zh-CN", "/zh-CN/home", "/zh-CN/docs", "/blog/x", "/sign-in"]) {
      expect(isPodHostPath(p), p).toBe(false);
    }
  });

  it("does not match a route that merely starts with the same letters", () => {
    expect(isPodHostPath("/dashboards-of-fame")).toBe(false);
    expect(isPodHostPath("/embedded-guide")).toBe(false);
  });
});

describe("releaseOnHostPage", () => {
  it("unregisters the nodepod SW on a marketing route", async () => {
    const reg = makeRegistration("https://app.test/__sw__.js");
    installFakeServiceWorker([reg]);
    await expect(releaseOnHostPage("/zh-CN/home")).resolves.toBe(true);
    expect(reg.unregister).toHaveBeenCalledOnce();
  });

  it("leaves unrelated service workers alone", async () => {
    const reg = makeRegistration("https://app.test/some-other-sw.js");
    installFakeServiceWorker([reg]);
    await expect(releaseOnHostPage("/zh-CN/home")).resolves.toBe(false);
    expect(reg.unregister).not.toHaveBeenCalled();
  });

  it("keeps it on a pod host route", async () => {
    const reg = makeRegistration("https://app.test/__sw__.js");
    installFakeServiceWorker([reg]);
    await expect(releaseOnHostPage("/embed/abc/airapp")).resolves.toBe(false);
    expect(reg.unregister).not.toHaveBeenCalled();
  });

  it("keeps it while another tab is running a pod", async () => {
    const reg = makeRegistration("https://app.test/__sw__.js");
    installFakeServiceWorker([reg]);
    const stop = beginPodHeartbeat();
    expect(isPodActive()).toBe(true);
    await expect(releaseOnHostPage("/zh-CN/home")).resolves.toBe(false);
    expect(reg.unregister).not.toHaveBeenCalled();
    stop();
    // once that tab is done, the next marketing visit may release it again
    expect(isPodActive()).toBe(false);
    await expect(releaseOnHostPage("/zh-CN/home")).resolves.toBe(true);
  });

  it("treats a stale heartbeat from a closed tab as no pod", async () => {
    const reg = makeRegistration("https://app.test/__sw__.js");
    installFakeServiceWorker([reg]);
    localStorage.setItem("busabase:nodepod:pod-active", String(Date.now() - 60_000));
    expect(isPodActive()).toBe(false);
    await expect(releaseOnHostPage("/zh-CN/home")).resolves.toBe(true);
  });
});

describe("ensureRegistered", () => {
  it("re-registers when a marketing visit released it", async () => {
    const sw = installFakeServiceWorker([]);
    sw.getRegistration = vi.fn(async () => undefined);
    await ensureRegistered();
    expect(sw.register).toHaveBeenCalledWith("/__sw__.js", {
      scope: "/",
      updateViaCache: "none",
    });
  });

  it("does nothing when Nodepod's own registration is still there", async () => {
    const sw = installFakeServiceWorker([makeRegistration("https://app.test/__sw__.js")]);
    await ensureRegistered();
    expect(sw.register).not.toHaveBeenCalled();
  });

  it("surfaces a useful error only after a retry also fails", async () => {
    const getRegistration = vi.fn(async () => {
      throw new Error("SecurityError");
    });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
    await expect(ensureRegistered()).rejects.toThrow(
      "AirApp preview requires HTTPS and Service Worker support",
    );
    expect(getRegistration).toHaveBeenCalledTimes(2);
  });

  it("recovers on retry when only the first attempt fails transiently", async () => {
    const sw = installFakeServiceWorker([]);
    let calls = 0;
    sw.getRegistration = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("Service Worker activation timed out");
      return undefined;
    });
    await expect(ensureRegistered()).resolves.toBeUndefined();
    expect(sw.getRegistration).toHaveBeenCalledTimes(2);
    expect(sw.register).toHaveBeenCalledOnce();
  });

  it("stops the run where service workers do not exist at all", async () => {
    vi.stubGlobal("navigator", {});
    await expect(ensureRegistered()).rejects.toThrow(
      "AirApp preview requires HTTPS and Service Worker support",
    );
    await expect(releaseOnHostPage("/zh-CN/home")).resolves.toBe(false);
  });

  it("waits until a newly activated worker controls the current page", async () => {
    const sw = installFakeServiceWorker([]);
    sw.getRegistration = vi.fn(async () => undefined);
    sw.controller = null as unknown as object;
    sw.addEventListener.mockImplementation((_event, listener) => {
      sw.controller = {};
      (listener as () => void)();
    });

    await expect(ensureRegistered()).resolves.toBeUndefined();
    expect(sw.addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function));
  });
});
