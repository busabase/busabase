import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginPodHeartbeat,
  ensureRegistered,
  isPodActive,
  isPodHostPath,
  NODEPOD_HOST_CLAIM_MESSAGE,
  releaseOnHostPage,
} from "../src/domains/airapp/utils/nodepod-service-worker";

/**
 * Nodepod registers its service worker at `scope: "/"`, so one AirApp run
 * leaves the whole origin — marketing site included — controlled by it. These
 * cover the lifetime scoping we put around that: release it where no pod can
 * live, keep it where one can, and put it back before the next boot.
 */

type FakeRegistration = {
  active: FakeWorker | null;
  waiting: FakeWorker | null;
  installing: FakeWorker | null;
  update: () => Promise<void>;
  unregister: () => Promise<boolean>;
};

type FakeWorker = {
  scriptURL: string;
  state: ServiceWorkerState;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
};

const makeWorker = (scriptURL: string): FakeWorker => ({
  scriptURL,
  state: "activated",
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  postMessage: vi.fn(),
});

const makeRegistration = (
  scriptURL: string,
  active: FakeWorker | null = makeWorker(scriptURL),
): FakeRegistration => ({
  active,
  waiting: null,
  installing: null,
  update: vi.fn(async () => undefined),
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
  const listeners = new Map<string, Set<() => void>>();
  const register = vi.fn(async (url: string) => {
    const registration = makeRegistration(`https://app.test${url}`);
    registrations[0] = registration;
    return registration;
  });
  const container = {
    controller: {},
    addEventListener: vi.fn((event: string, listener: () => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    removeEventListener: vi.fn((event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
    }),
    getRegistrations: vi.fn(async () => registrations),
    getRegistration: vi.fn(async () => registrations[0]),
    register,
    ready: Promise.resolve(registrations[0]),
    emitControllerChange() {
      for (const listener of listeners.get("controllerchange") ?? []) listener();
    },
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

  it("reports registration failures without mislabeling them as browser support", async () => {
    const getRegistration = vi.fn(async () => {
      throw new Error("SecurityError");
    });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
    await expect(ensureRegistered()).rejects.toMatchObject({
      code: "SW_REGISTRATION_FAILED",
      // The user-visible copy is localized in the i18n catalog and resolved by
      // `RunPanel` from `code`; `message` is the stable log identifier.
      message: "Nodepod Service Worker: SW_REGISTRATION_FAILED",
    });
    // Registration gets one retry; a second failure is reported rather than
    // retried again, so this must not loop.
    expect(getRegistration).toHaveBeenCalledTimes(2);
  });

  it("retries registration once when only the first attempt fails transiently", async () => {
    const sw = installFakeServiceWorker([]);
    let calls = 0;
    sw.getRegistration = vi.fn(async () => {
      calls += 1;
      // What a dev-server recompile mid-handshake looks like from here.
      if (calls === 1) throw new Error("Failed to fetch /__sw__.js");
      return undefined;
    });

    await expect(ensureRegistered()).resolves.toBeUndefined();
    expect(sw.getRegistration).toHaveBeenCalledTimes(2);
    expect(sw.register).toHaveBeenCalledOnce();
  });

  it("does not retry a phase that already has its own timeout budget", async () => {
    vi.useFakeTimers();
    const registration = makeRegistration("https://app.test/__sw__.js");
    const sw = installFakeServiceWorker([registration]);
    sw.controller = null as unknown as object;
    const result = expect(ensureRegistered()).rejects.toMatchObject({ code: "SW_CONTROL_TIMEOUT" });

    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    // A control timeout is not a registration problem: one pass, no second
    // 10s wait stacked on top.
    expect(sw.getRegistration).toHaveBeenCalledOnce();
    expect(registration.active?.postMessage).toHaveBeenCalledOnce();
  });

  // A browser that keeps the Service Worker API but refuses to run workers
  // (enterprise policy, embedded webview, a test runner blocking them) can
  // settle these promises with nothing instead of rejecting. Reaching for
  // `.active` on that would put a raw `TypeError` in front of the user, which
  // is the class of misleading error the codes exist to remove.
  it("names the registration phase when register() resolves with nothing", async () => {
    const sw = installFakeServiceWorker([]);
    sw.getRegistration = vi.fn(async () => undefined);
    sw.register = vi.fn(async () => undefined) as unknown as typeof sw.register;
    sw.controller = null as unknown as object;
    await expect(ensureRegistered()).rejects.toMatchObject({ code: "SW_REGISTRATION_FAILED" });
  });

  it("names the activation phase when ready resolves without an active worker", async () => {
    const registration = makeRegistration("https://app.test/__sw__.js", null);
    const sw = installFakeServiceWorker([registration]);
    sw.controller = null as unknown as object;
    sw.ready = Promise.resolve(undefined as unknown as FakeRegistration);
    await expect(ensureRegistered()).rejects.toMatchObject({ code: "SW_ACTIVATION_TIMEOUT" });
  });

  it("asks an active worker to claim an uncontrolled first-run page", async () => {
    const registration = makeRegistration("https://app.test/__sw__.js");
    const sw = installFakeServiceWorker([registration]);
    sw.controller = null as unknown as object;
    registration.active?.postMessage.mockImplementation((message) => {
      expect(message).toEqual({ type: NODEPOD_HOST_CLAIM_MESSAGE });
      queueMicrotask(() => {
        sw.controller = {};
        sw.emitControllerChange();
      });
    });

    await expect(ensureRegistered()).resolves.toBeUndefined();
    expect(registration.update).toHaveBeenCalledOnce();
    expect(registration.active?.postMessage).toHaveBeenCalledOnce();
  });

  it("waits for an updated worker before claiming during a rolling deployment", async () => {
    const oldWorker = makeWorker("https://app.test/__sw__.js?old");
    const updatedWorker = makeWorker("https://app.test/__sw__.js");
    updatedWorker.state = "installing";
    const registration = makeRegistration("https://app.test/__sw__.js", oldWorker);
    registration.installing = updatedWorker;
    const sw = installFakeServiceWorker([registration]);
    sw.controller = null as unknown as object;
    updatedWorker.addEventListener.mockImplementation((_event, listener) => {
      queueMicrotask(() => {
        updatedWorker.state = "activated";
        registration.active = updatedWorker;
        registration.installing = null;
        (listener as () => void)();
      });
    });
    updatedWorker.postMessage.mockImplementation(() => {
      queueMicrotask(() => {
        sw.controller = {};
        sw.emitControllerChange();
      });
    });

    await expect(ensureRegistered()).resolves.toBeUndefined();
    expect(oldWorker.postMessage).not.toHaveBeenCalled();
    expect(updatedWorker.postMessage).toHaveBeenCalledWith({
      type: NODEPOD_HOST_CLAIM_MESSAGE,
    });
  });

  it("shares one registration and claim flight across concurrent AirApp surfaces", async () => {
    const registration = makeRegistration("https://app.test/__sw__.js");
    const sw = installFakeServiceWorker([registration]);
    sw.controller = null as unknown as object;
    registration.active?.postMessage.mockImplementation(() => {
      queueMicrotask(() => {
        sw.controller = {};
        sw.emitControllerChange();
      });
    });

    await Promise.all([ensureRegistered(), ensureRegistered()]);
    expect(sw.getRegistration).toHaveBeenCalledOnce();
    expect(registration.update).toHaveBeenCalledOnce();
    expect(registration.active?.postMessage).toHaveBeenCalledOnce();
  });

  it("stops the run where service workers do not exist at all", async () => {
    vi.stubGlobal("navigator", {});
    await expect(ensureRegistered()).rejects.toMatchObject({
      code: "SERVICE_WORKER_UNAVAILABLE",
    });
    await expect(releaseOnHostPage("/zh-CN/home")).resolves.toBe(false);
  });

  it("stops immediately outside a secure context", async () => {
    vi.stubGlobal("window", { isSecureContext: false });
    installFakeServiceWorker([]);
    await expect(ensureRegistered()).rejects.toMatchObject({ code: "INSECURE_CONTEXT" });
  });

  it("reports a specific control timeout when host-claim cannot control the page", async () => {
    vi.useFakeTimers();
    const registration = makeRegistration("https://app.test/__sw__.js");
    const sw = installFakeServiceWorker([registration]);
    sw.controller = null as unknown as object;
    const result = expect(ensureRegistered()).rejects.toMatchObject({ code: "SW_CONTROL_TIMEOUT" });

    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(registration.active?.postMessage).toHaveBeenCalledWith({
      type: NODEPOD_HOST_CLAIM_MESSAGE,
    });
  });

  it("reports a specific activation timeout when registration never becomes active", async () => {
    vi.useFakeTimers();
    const registration = makeRegistration("https://app.test/__sw__.js", null);
    const sw = installFakeServiceWorker([registration]);
    sw.controller = null as unknown as object;
    sw.ready = new Promise(() => undefined);
    const result = expect(ensureRegistered()).rejects.toMatchObject({
      code: "SW_ACTIVATION_TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(15_000);
    await result;
  });
});
