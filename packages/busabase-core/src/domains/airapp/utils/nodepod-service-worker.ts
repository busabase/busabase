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

/** Upper bound on waiting for a re-registered worker to activate. */
const SW_READY_TIMEOUT_MS = 5_000;

/**
 * Route prefixes that legitimately run pods and must keep the SW.
 * `/embed/*` is the public AirApp Embed host; `/dashboard*` is the Run panel.
 */
const POD_HOST_PATH_PREFIXES = ["/dashboard", "/embed", "/__virtual__", "/__preview__"];

const hasServiceWorker = (): boolean =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

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
  if (!hasServiceWorker()) return;
  try {
    const existing = await navigator.serviceWorker.getRegistration("/");
    if (existing) return;
    await navigator.serviceWorker.register(SW_PATH, { scope: "/", updateViaCache: "none" });
    // Bounded: `ready` is a convenience, not a requirement — Nodepod's own
    // `initServiceWorker` awaits activation with its own timeout right after
    // this. Never let a wait here be what stops a run from starting.
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(resolve, SW_READY_TIMEOUT_MS)),
    ]);
  } catch {
    // Nodepod's own boot-time registration still runs and surfaces the error.
  }
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
