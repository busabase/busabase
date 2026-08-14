/**
 * The AirApp connect gate — the browser half of local onboarding.
 *
 * `busabase-sdk/airapp-node` already owns the *flow* (PKCE, credential
 * rotation, Space validation, the `/api/v1` proxy). This module owns the
 * remaining copy-paste: deciding which of the three screens to show, and
 * drawing them. 62 App-in-Skills carried a 160-line renderer whose only
 * per-app difference was the display name interpolated into an HTML string,
 * plus a byte-identical 290-line stylesheet — while the app-creator template
 * grew a second, differently-classed implementation of the same three screens.
 *
 * Structure, deliberately: every decision and every piece of markup is a pure
 * function of the gateway's status. The DOM is touched only in `mount` /
 * `wire`. That is what makes the escaping (the one security-relevant part —
 * `oauth_error` and Space names both come from outside) testable without a
 * browser, and what lets an app swap the renderer without reimplementing the
 * state machine.
 *
 * Import `busabase-sdk/airapp-gate.css` (or copy it) for the default look; it
 * is themed entirely through custom properties.
 *
 * @example
 * ```ts
 * import { createAirAppConnectGate } from "busabase-sdk/airapp-gate";
 *
 * const gate = createAirAppConnectGate({
 *   appName: "Kelly CRM",
 *   onProvision: () => provider.provisionResources(),
 * });
 *
 * // Before mounting the app shell:
 * if (await gate.pass({ onReady: () => start() })) start();
 *
 * // When loading data fails because the workspace is not set up yet:
 * gate.renderSetupRequired(error, () => start());
 * ```
 */

// TYPE-ONLY on purpose: `airapp-node` is a Node module (filesystem-backed
// credential store). `import type` is erased at build time, so nothing from it
// reaches the browser bundle — but the status contract stays single-sourced
// instead of drifting as a hand-copied interface. Never make this a value import.
import type { BusabaseAirAppAuthStatus } from "./airapp-node.js";

export type { BusabaseAirAppAuthStatus };

/** Which screen the gate owes the operator right now. */
export type AirAppGateScreen = "connect" | "space" | "ready";

/**
 * Decide the screen from the gateway's status. Headless — a custom renderer
 * should call this rather than re-deriving the rules from `connected`.
 *
 * Driven by `readiness`, with a fallback to the older `connected` /
 * `requiresSpace` pair so an app can upgrade the SDK before its server.
 */
export function selectAirAppGateScreen(
  status: Partial<BusabaseAirAppAuthStatus> | null | undefined,
): AirAppGateScreen {
  if (!status) return "connect";
  switch (status.readiness) {
    case "needs_connection":
    case "needs_auth":
      return "connect";
    case "needs_space":
      return "space";
    case "ready":
      return "ready";
    default:
      break;
  }
  if (!status.connected) return "connect";
  return status.requiresSpace ? "space" : "ready";
}

/** The five setup states, decoded into what the workspace screen needs to know. */
export interface AirAppSetupDescription {
  code: string;
  /** The message with its `CODE: ` prefix stripped. */
  detail: string;
  title: string;
  /** Offer an "Initialize workspace" button. */
  canProvision: boolean;
  /** Offer a "Check again" button (the app cannot act; the operator can retry). */
  canRetry: boolean;
}

/**
 * Decode a setup failure. Accepts an `AirAppSetupError`, any `Error` whose
 * message uses the historical `"CODE: detail"` shape, or a bare string — the
 * generated apps throw all three spellings.
 */
export function describeAirAppSetupError(error: unknown): AirAppSetupDescription {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  const raw = String(
    (typeof error === "object" && error !== null && "message" in error
      ? (error as { message?: unknown }).message
      : error) ?? "SETUP_REQUIRED",
  );
  const parsed = /^([A-Z_]+):\s*(.*)$/s.exec(raw);
  const resolvedCode = code || parsed?.[1] || raw.trim() || "SETUP_REQUIRED";
  const detail = parsed ? parsed[2] : code ? raw : "";
  const pending = resolvedCode === "SETUP_PENDING";
  const canProvision = resolvedCode === "SETUP_REQUIRED";
  return {
    code: resolvedCode,
    detail,
    title: pending
      ? "Waiting for workspace approval"
      : canProvision
        ? "Initialize the Busabase workspace"
        : "Workspace not ready",
    canProvision,
    canRetry: resolvedCode === "SETUP_PENDING" || resolvedCode === "SCHEMA_INCOMPLETE",
  };
}

export interface AirAppGateOptions {
  /** Shown in the gate's prose, e.g. "Kelly CRM". The one per-app value. */
  appName: string;
  /**
   * Where to mount. A selector, an element, or omitted to create and prepend
   * `#busabaseAirAppGate` to `<body>`.
   */
  mount?: string | HTMLElement;
  /** Prefix for the gateway routes; `""` means `/auth/status`, `/auth/start`, … */
  authBasePath?: string;
  /**
   * Whether this run owes a gate at all. Return `false` for a Busabase-hosted
   * AirApp (the ambient session owns auth) or for a demo/offline mode.
   *
   * **Pass this.** Omitted, `pass()` falls back to probing `/auth/status` and
   * treating an unreachable or non-JSON answer as "hosted" — which works, but
   * infers something the host already states outright. A Busabase-hosted AirApp
   * is identified by the `BUSABASE_AIRAPP_RUNTIME` env var Busabase injects into
   * the process it spawns, surfaced to the browser by the app's own server;
   * never by hostname, iframe nesting, or path, since a hosted AirApp can be
   * served from localhost and a standalone run can be reached over a dev tunnel.
   */
  shouldGate?: () => boolean | Promise<boolean>;
  /** Injected for tests. */
  fetch?: typeof globalThis.fetch;
  /** Called by the workspace screen's "Initialize workspace" button. */
  onProvision?: () => Promise<unknown>;
  /** Where the "open the demo" escape hatch points. Omit to hide it. */
  demoHref?: string | null;
  /** Replace the default markup wholesale while keeping the state machine. */
  render?: AirAppGateRenderer;
}

export interface AirAppGateRenderer {
  connect(view: AirAppConnectView): string;
  space(view: AirAppSpaceView): string;
  workspace(view: AirAppWorkspaceView): string;
}

export interface AirAppConnectView {
  appName: string;
  cloudBaseUrl: string;
  /** Set when the operator is here because the session lapsed, not first-run. */
  reconnect: boolean;
  /** `?oauth_error=` from the callback redirect. Untrusted. */
  oauthError: string;
  authBasePath: string;
}

export interface AirAppSpaceView {
  appName: string;
  baseUrl: string;
  spaces: { id: string; name: string }[];
}

export interface AirAppWorkspaceView extends AirAppSetupDescription {
  appName: string;
  demoHref: string | null;
}

/** HTML-escape. Every interpolation below goes through this. */
export const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const panel = (labelledBy: string, head: string, body: string, footer: string) =>
  `<div class="bb-gate-overlay"><section class="bb-gate-panel" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}">` +
  `<div class="bb-gate-head"><div>${head}</div></div>` +
  `<div class="bb-gate-body">${body}</div>` +
  `<div class="bb-gate-footer">${footer}</div>` +
  `</section></div>`;

/** The stock three screens. Pure string builders — no DOM, no fetch. */
export const defaultAirAppGateRenderer: AirAppGateRenderer = {
  connect(view) {
    const head =
      `<h1 id="bbGateConnectTitle">Connect Busabase</h1>` +
      `<p>${escapeHtml(view.appName)} reads and writes through your Busabase workspace.</p>`;
    const body =
      (view.oauthError
        ? `<p class="bb-gate-error" role="alert">${escapeHtml(view.oauthError)}</p>`
        : "") +
      (view.reconnect
        ? `<p class="bb-gate-note">Your session expired. Reconnect to continue.</p>`
        : "") +
      `<h2>Server</h2><div class="bb-gate-server-grid">` +
      `<label class="bb-gate-server-card is-selected"><input type="radio" name="server_mode" value="cloud" checked><span><strong>Busabase Cloud</strong><span>${escapeHtml(hostOf(view.cloudBaseUrl))}</span></span></label>` +
      `<label class="bb-gate-server-card"><input type="radio" name="server_mode" value="custom"><span><strong>Custom server</strong><span>Self-hosted or enterprise address</span></span></label>` +
      `</div>` +
      `<label class="bb-gate-custom-url" data-custom-url hidden><span>Busabase URL</span><input type="url" name="custom_base_url" inputmode="url" placeholder="https://busabase.example.com" autocomplete="url"></label>` +
      `<input type="hidden" name="base_url" value="${escapeHtml(view.cloudBaseUrl)}">`;
    const footer =
      `<span class="bb-gate-note">OAuth credentials stay on this machine (~/.busabase/airapps)</span>` +
      `<button class="bb-gate-primary" type="submit">Connect Busabase</button>`;
    // The whole panel is the form: the browser POSTs to the gateway's own
    // /auth/start, so the connect step needs no JavaScript to work.
    return `<form method="post" action="${escapeHtml(`${view.authBasePath}/auth/start`)}" data-connect-form>${panel("bbGateConnectTitle", head, body, footer)}</form>`;
  },

  space(view) {
    const options = view.spaces
      .map(
        (space) =>
          `<option value="${escapeHtml(space.id)}">${escapeHtml(space.name)} · ${escapeHtml(space.id)}</option>`,
      )
      .join("");
    const head =
      `<h1 id="bbGateSpaceTitle">Choose a Busabase Space</h1>` +
      `<p>Signed in to <strong>${escapeHtml(view.baseUrl)}</strong>. Choose where ${escapeHtml(view.appName)}'s data lives.</p>`;
    const body =
      `<label class="bb-gate-space-select"><span>Space</span><select name="space_id" required>${options}</select></label>` +
      `<p class="bb-gate-error" data-space-error hidden></p>`;
    const footer =
      `<span class="bb-gate-note">Resources are only checked after you confirm</span>` +
      `<button class="bb-gate-primary" type="submit">Use this Space</button>`;
    return `<form data-space-form>${panel("bbGateSpaceTitle", head, body, footer)}</form>`;
  },

  workspace(view) {
    const head = `<h1 id="bbGateWorkspaceTitle">${escapeHtml(view.title)}</h1>`;
    const body = view.canProvision
      ? `<p>${escapeHtml(view.appName)} will create its Folder and Bases in the current Space.</p>` +
        `<p>Submitted as one idempotent Busabase ChangeRequest; nothing existing is deleted or repurposed.</p>` +
        `<p class="bb-gate-error" data-workspace-status hidden></p>`
      : `<p>${escapeHtml(view.detail)}</p>` +
        `<p>${escapeHtml(view.appName)} never asks you to create Nodes or Bases by hand, and never silently falls back to local data.</p>` +
        `<p class="bb-gate-error" data-workspace-status hidden></p>`;
    const footer =
      (view.demoHref
        ? `<a class="bb-gate-link" href="${escapeHtml(view.demoHref)}">Open the read-only demo</a>`
        : "<span></span>") +
      (view.canProvision
        ? `<button class="bb-gate-primary" type="button" data-provision>Initialize workspace</button>`
        : view.canRetry
          ? `<button class="bb-gate-primary" type="button" data-retry>Check again</button>`
          : "");
    return panel("bbGateWorkspaceTitle", head, body, footer);
  },
};

const hostOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

export const DEFAULT_CLOUD_BASE_URL = "https://busabase.com";

export interface AirAppConnectGate {
  /**
   * Resolve the gate before the app shell mounts. `true` means the app may
   * load data; `false` means a screen is up and waiting on the operator — call
   * again after `onReady` fires.
   */
  pass(options?: { onReady?: () => void }): Promise<boolean>;
  /** Show the workspace screen for a setup error thrown while loading data. */
  renderSetupRequired(error: unknown, onRetry: () => void): void;
  /** Take the gate down and give scrolling back to the page. */
  close(): void;
  /** Fetch the gateway's status without rendering anything. */
  status(): Promise<BusabaseAirAppAuthStatus | null>;
}

/**
 * Build a gate bound to one app.
 *
 * Nothing is rendered until `pass()` decides a screen is owed, so it is safe to
 * construct at module scope.
 */
export function createAirAppConnectGate(options: AirAppGateOptions): AirAppConnectGate {
  const {
    appName,
    authBasePath = "",
    onProvision,
    demoHref = null,
    render = defaultAirAppGateRenderer,
  } = options;
  const doFetch = options.fetch ?? globalThis.fetch;

  const root = (): HTMLElement => {
    if (options.mount) {
      const element =
        typeof options.mount === "string"
          ? document.querySelector<HTMLElement>(options.mount)
          : options.mount;
      if (!element) throw new Error(`AirApp gate mount not found: ${String(options.mount)}`);
      document.documentElement.classList.add("bb-gate-active");
      return element;
    }
    let element = document.querySelector<HTMLElement>("#busabaseAirAppGate");
    if (!element) {
      element = document.createElement("div");
      element.id = "busabaseAirAppGate";
      document.body.prepend(element);
    }
    document.documentElement.classList.add("bb-gate-active");
    return element;
  };

  const close = () => {
    if (options.mount) {
      const element =
        typeof options.mount === "string"
          ? document.querySelector<HTMLElement>(options.mount)
          : options.mount;
      if (element) element.innerHTML = "";
    } else {
      document.querySelector("#busabaseAirAppGate")?.remove();
    }
    document.documentElement.classList.remove("bb-gate-active");
  };

  const status = async (): Promise<BusabaseAirAppAuthStatus | null> => {
    try {
      const response = await doFetch(`${authBasePath}/auth/status`, {
        headers: { accept: "application/json" },
      });
      // A hosted origin's catch-all can answer 200 with an HTML shell; treating
      // that as a status object would silently mis-drive the gate.
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !type.includes("application/json")) return null;
      return (await response.json()) as BusabaseAirAppAuthStatus;
    } catch {
      return null;
    }
  };

  const renderConnect = (current: BusabaseAirAppAuthStatus | null) => {
    const element = root();
    const oauthError = new URLSearchParams(window.location.search).get("oauth_error") ?? "";
    element.innerHTML = render.connect({
      appName,
      cloudBaseUrl: current?.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL,
      reconnect: current?.readiness === "needs_auth",
      oauthError,
      authBasePath,
    });
    wireConnect(element, current?.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL);
  };

  const renderSpace = (current: BusabaseAirAppAuthStatus, onReady: () => void) => {
    const element = root();
    element.innerHTML = render.space({
      appName,
      baseUrl: current.baseUrl ?? "",
      spaces: current.spaces ?? [],
    });
    wireSpace(element, onReady);
  };

  const wireConnect = (element: HTMLElement, cloudBaseUrl: string) => {
    const form = element.querySelector<HTMLFormElement>("[data-connect-form]");
    if (!form) return;
    const customField = form.querySelector<HTMLElement>("[data-custom-url]");
    const customInput = customField?.querySelector("input") ?? null;
    const hiddenBaseUrl = form.querySelector<HTMLInputElement>('input[name="base_url"]');
    for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="server_mode"]')) {
      radio.addEventListener("change", () => {
        const custom = radio.value === "custom";
        for (const card of form.querySelectorAll<HTMLElement>(".bb-gate-server-card")) {
          card.classList.toggle("is-selected", card.querySelector("input")?.checked === true);
        }
        if (customField) customField.hidden = !custom;
        if (customInput) customInput.required = custom;
        if (hiddenBaseUrl) hiddenBaseUrl.value = custom ? (customInput?.value ?? "") : cloudBaseUrl;
        if (custom) customInput?.focus();
      });
    }
    customInput?.addEventListener("input", () => {
      if (hiddenBaseUrl) hiddenBaseUrl.value = customInput.value;
    });
  };

  const wireSpace = (element: HTMLElement, onReady: () => void) => {
    const form = element.querySelector<HTMLFormElement>("[data-space-form]");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
      const error = form.querySelector<HTMLElement>("[data-space-error]");
      if (button) button.disabled = true;
      if (error) error.hidden = true;
      try {
        const response = await doFetch(`${authBasePath}/auth/space`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(new FormData(form) as unknown as Record<string, string>),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) {
          if (error) {
            error.textContent = result.error || "Could not select a Space.";
            error.hidden = false;
          }
          if (button) button.disabled = false;
          return;
        }
        onReady();
      } catch {
        if (error) {
          error.textContent = "Could not reach this app's server.";
          error.hidden = false;
        }
        if (button) button.disabled = false;
      }
    });
  };

  const renderSetupRequired = (error: unknown, onRetry: () => void) => {
    const element = root();
    element.innerHTML = render.workspace({
      ...describeAirAppSetupError(error),
      appName,
      demoHref,
    });
    element.querySelector("[data-retry]")?.addEventListener("click", () => onRetry());
    element.querySelector("[data-provision]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const line = element.querySelector<HTMLElement>("[data-workspace-status]");
      button.disabled = true;
      if (line) {
        line.hidden = false;
        line.textContent = "Submitting the workspace structure…";
      }
      try {
        await onProvision?.();
        onRetry();
      } catch (provisionError) {
        // Re-render rather than patch: a failed provision usually moves the app
        // to a *different* setup state (pending approval, conflict), which owes
        // the operator different buttons, not just different text.
        renderSetupRequired(provisionError, onRetry);
      }
    });
  };

  const pass = async ({ onReady }: { onReady?: () => void } = {}) => {
    // The host's own answer wins when the app supplies one; only guess when it
    // does not.
    if (options.shouldGate && !(await options.shouldGate())) {
      close();
      return true;
    }
    const current = await status();
    // No gateway reachable (a Busabase-hosted AirApp has no /auth/* routes at
    // all) — the ambient session owns auth, so never gate.
    if (!current) return true;
    const screen = selectAirAppGateScreen(current);
    if (screen === "ready") {
      close();
      return true;
    }
    if (screen === "space") {
      renderSpace(current, () => {
        close();
        onReady?.();
      });
      return false;
    }
    renderConnect(current);
    return false;
  };

  return { pass, renderSetupRequired, close, status };
}
