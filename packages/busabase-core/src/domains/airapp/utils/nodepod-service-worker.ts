/**
 * Lifecycle helpers for Nodepod's service worker (`/__sw__.js`).
 *
 * Nodepod registers its SW with `scope: "/"` from inside `Nodepod.boot()` —
 * the scope is hard-coded upstream and cannot be narrowed, because a pod's
 * preview iframe has its `/__virtual__/{instance}/{port}` prefix stripped from
 * `location` so the AirApp's own root-relative requests (`/api/x`, `/assets/y`)
 * resolve against the real origin root. The SW has to own `/` to catch them.
 *
 * The side effect is that one AirApp run leaves the ENTIRE origin controlled
 * forever after — including the marketing site, which has no pod, gets nothing
 * from the SW, and still pays for it: a live pod claims the path `/`, so every
 * marketing subresource matches that claim and takes the SW's async
 * `respondWith` → `clients.get()` → "oh, top-level host, never mind" →
 * `fetch(request)` path. Correct, but the round trip is already paid by then.
 *
 * So we scope it ourselves, by lifetime instead of by URL: release the
 * registration on pages that can never host a pod (`releaseOnHostPage`), and
 * make sure it is back before the next boot (`ensureRegistered`).
 */

const SW_PATH = "/__sw__.js";

/** localStorage key holding the "a pod is alive somewhere" heartbeat. */
const POD_ACTIVE_KEY = "busabase:nodepod:pod-active";

/** How long a heartbeat stays trusted after its last write. */
const POD_ACTIVE_TTL_MS = 20_000;

/** How often a live runner refreshes the heartbeat. */
const POD_HEARTBEAT_INTERVAL_MS = 5_000;

/** Upper bounds for the two observable Service Worker lifecycle phases. */
const SW_ACTIVATION_TIMEOUT_MS = 15_000;
const SW_CONTROL_TIMEOUT_MS = 10_000;

export const NODEPOD_HOST_CLAIM_MESSAGE = "busabase-host-claim";

export type NodepodServiceWorkerErrorCode =
  | "INSECURE_CONTEXT"
  | "SERVICE_WORKER_UNAVAILABLE"
  | "SW_REGISTRATION_FAILED"
  | "SW_ACTIVATION_TIMEOUT"
  | "SW_CONTROL_TIMEOUT";

/**
 * The user-visible copy for each code lives in the i18n catalog
 * (`messages.airapp.swError[code]`) and is resolved by `RunPanel` — this is a
 * runtime error on a localized surface, so it must not carry English text of
 * its own. `message` is therefore the log identifier: stable, English, and
 * greppable in AirApp Logs and in the log aggregator. `cause` keeps the
 * underlying browser error next to it.
 */
export class NodepodServiceWorkerError extends Error {
  readonly code: NodepodServiceWorkerErrorCode;

  constructor(code: NodepodServiceWorkerErrorCode, options?: ErrorOptions) {
    super(`Nodepod Service Worker: ${code}`, options);
    this.code = code;
    this.name = "NodepodServiceWorkerError";
  }
}

/**
 * Route prefixes that legitimately run pods and must keep the SW.
 * `/embed/*` is the public AirApp Embed host; `/dashboard*` is the Run panel.
 */
const POD_HOST_PATH_PREFIXES = ["/dashboard", "/embed", "/__virtual__", "/__preview__"];

const hasServiceWorker = (): boolean =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

const waitForController = async (): Promise<void> => {
  if (navigator.serviceWorker.controller) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      reject(
        new NodepodServiceWorkerError("SW_CONTROL_TIMEOUT", {
          cause: new Error("Service Worker did not take control of this page"),
        }),
      );
    }, SW_CONTROL_TIMEOUT_MS);
    const onControllerChange = () => {
      if (!navigator.serviceWorker.controller) return;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  });
};

const readStorage = (key: string): string | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string | null): void => {
  try {
    if (typeof localStorage === "undefined") return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode / storage disabled — heartbeat simply degrades to "no pod"
  }
};

/**
 * True while any tab is running a pod. Cross-tab by way of localStorage: a tab
 * that closes without disposing leaves a stale timestamp, which expires on its
 * own after {@link POD_ACTIVE_TTL_MS}.
 */
export const isPodActive = (): boolean => {
  const raw = readStorage(POD_ACTIVE_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < POD_ACTIVE_TTL_MS;
};

/**
 * Start (or refresh) the "pod alive" heartbeat. Returns a stop function that
 * clears it — call it from the runner's `dispose()`.
 */
export const beginPodHeartbeat = (): (() => void) => {
  writeStorage(POD_ACTIVE_KEY, String(Date.now()));
  const timer = setInterval(() => {
    writeStorage(POD_ACTIVE_KEY, String(Date.now()));
  }, POD_HEARTBEAT_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    writeStorage(POD_ACTIVE_KEY, null);
  };
};

const waitForActivation = async (
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorkerRegistration> => {
  if (registration.active) return registration;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new NodepodServiceWorkerError("SW_ACTIVATION_TIMEOUT", {
                cause: new Error("Service Worker activation timed out"),
              }),
            ),
          SW_ACTIVATION_TIMEOUT_MS,
        );
      }),
    ]);
    // `ready` is specified to settle only once a registration has an active
    // worker, but a browser that disables Service Workers while keeping the API
    // (enterprise policy, embedded webview, a test runner blocking them) can
    // resolve it with nothing. Say which phase failed instead of letting a
    // `TypeError` reach the panel.
    if (!ready?.active) {
      throw new NodepodServiceWorkerError("SW_ACTIVATION_TIMEOUT", {
        cause: new Error("Service Worker became ready without an active worker"),
      });
    }
    return ready;
  } catch (cause) {
    if (cause instanceof NodepodServiceWorkerError) throw cause;
    throw new NodepodServiceWorkerError("SW_ACTIVATION_TIMEOUT", { cause });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const waitForWorkerActivation = async (worker: ServiceWorker): Promise<void> => {
  if (worker.state === "activated") return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.removeEventListener("statechange", onStateChange);
      reject(
        new NodepodServiceWorkerError("SW_ACTIVATION_TIMEOUT", {
          cause: new Error("Updated Service Worker did not activate in time"),
        }),
      );
    }, SW_ACTIVATION_TIMEOUT_MS);
    const onStateChange = () => {
      if (worker.state === "activated") {
        clearTimeout(timeout);
        worker.removeEventListener("statechange", onStateChange);
        resolve();
      } else if (worker.state === "redundant") {
        clearTimeout(timeout);
        worker.removeEventListener("statechange", onStateChange);
        reject(
          new NodepodServiceWorkerError("SW_ACTIVATION_TIMEOUT", {
            cause: new Error("Updated Service Worker became redundant before activation"),
          }),
        );
      }
    };
    worker.addEventListener("statechange", onStateChange);
  });
};

const getOrRegister = async (): Promise<ServiceWorkerRegistration> => {
  try {
    const existing = await navigator.serviceWorker.getRegistration("/");
    if (existing) {
      // During a rolling deployment an uncontrolled page may still see the
      // previous worker. Ask the browser to fetch the current script before we
      // use the Busabase-specific host-claim message. A failed update is not a
      // reason to discard an otherwise active worker; the claim phase below
      // will report the actionable failure if it cannot take control.
      if (!navigator.serviceWorker.controller) {
        try {
          await existing.update();
        } catch {
          // Continue with the active worker.
        }
        const updatedWorker = existing.installing ?? existing.waiting;
        if (updatedWorker) await waitForWorkerActivation(updatedWorker);
      }
      return existing;
    }
    const registered = await navigator.serviceWorker.register(SW_PATH, {
      scope: "/",
      updateViaCache: "none",
    });
    // Same reason as the `ready` guard below: a blocked-but-present Service
    // Worker API can resolve `register()` with nothing rather than rejecting.
    if (!registered) throw new Error("register() resolved without a registration");
    return registered;
  } catch (cause) {
    if (cause instanceof NodepodServiceWorkerError) throw cause;
    throw new NodepodServiceWorkerError("SW_REGISTRATION_FAILED", { cause });
  }
};

/**
 * One retry, registration only.
 *
 * `register()` can lose a one-off race against something slow serving
 * `/__sw__.js` — a dev-server recompile mid-handshake is the case actually
 * observed — with no relation to browser support. That matters more than it
 * looks: auto-run does not re-run a failed node (`error` stays on screen for
 * the user to read), so a transient registration failure costs the user a
 * manual Restart for something a second call resolves.
 *
 * Deliberately narrow. Activation and control already have their own budgets
 * (15s / 10s) and retrying those would only double the wait before the user
 * sees anything, while the two capability checks in `ensureRegistered` are not
 * reached from here at all. A second failure is reported as-is, with its own
 * code — never collapsed back into a generic "unsupported browser".
 */
const getOrRegisterWithRetry = async (): Promise<ServiceWorkerRegistration> => {
  try {
    return await getOrRegister();
  } catch (caught) {
    const transient =
      caught instanceof NodepodServiceWorkerError && caught.code === "SW_REGISTRATION_FAILED";
    if (!transient) throw caught;
    return await getOrRegister();
  }
};

const registerActivateAndClaim = async (): Promise<void> => {
  const registration = await waitForActivation(await getOrRegisterWithRetry());
  if (navigator.serviceWorker.controller) return;
  const activeWorker = registration.active;
  if (!activeWorker) {
    throw new NodepodServiceWorkerError("SW_ACTIVATION_TIMEOUT", {
      cause: new Error("Service Worker registration has no active worker"),
    });
  }
  try {
    activeWorker.postMessage({ type: NODEPOD_HOST_CLAIM_MESSAGE });
  } catch (cause) {
    throw new NodepodServiceWorkerError("SW_CONTROL_TIMEOUT", { cause });
  }
  await waitForController();
};

let registrationFlight: Promise<void> | null = null;

/**
 * Make sure `/__sw__.js` is registered before a pod boots.
 *
 * Needed because `releaseOnHostPage` can have unregistered it during a
 * client-side visit to a marketing route, while Nodepod's `RequestProxy` is a
 * page-lifetime singleton that caches `swReady` and would then skip its own
 * registration. Re-registering here is safe either way: the SW calls
 * `skipWaiting()` + `clients.claim()` on activate, so the resulting
 * `controllerchange` makes Nodepod redo its init handshake.
 */
export const ensureRegistered = async (): Promise<void> => {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new NodepodServiceWorkerError("INSECURE_CONTEXT");
  }
  if (!hasServiceWorker()) {
    throw new NodepodServiceWorkerError("SERVICE_WORKER_UNAVAILABLE");
  }
  if (registrationFlight) return registrationFlight;
  const flight = registerActivateAndClaim().finally(() => {
    if (registrationFlight === flight) registrationFlight = null;
  });
  registrationFlight = flight;
  return flight;
};

/** A path that can never host a pod, so it never needs the SW. */
export const isPodHostPath = (pathname: string): boolean =>
  POD_HOST_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * Drop the Nodepod SW registration when the current page cannot host a pod and
 * no other tab is running one.
 *
 * Unregistering does not disturb the page that is already controlled — existing
 * clients keep their controller until they unload — so this is about the NEXT
 * load: it is what actually keeps the marketing site out of the SW.
 *
 * @returns whether a registration was released.
 */
export const releaseOnHostPage = async (pathname: string): Promise<boolean> => {
  if (!hasServiceWorker()) return false;
  if (isPodHostPath(pathname)) return false;
  if (isPodActive()) return false;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    let released = false;
    for (const registration of registrations) {
      const scriptURL =
        registration.active?.scriptURL ??
        registration.waiting?.scriptURL ??
        registration.installing?.scriptURL ??
        "";
      if (!scriptURL.endsWith(SW_PATH)) continue;
      released = (await registration.unregister()) || released;
    }
    return released;
  } catch {
    return false;
  }
};
