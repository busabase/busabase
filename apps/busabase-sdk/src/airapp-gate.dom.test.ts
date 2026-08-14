/**
 * @vitest-environment jsdom
 *
 * The DOM half of the gate: mounting, and the two forms' wiring. The screen
 * decisions and the markup itself are covered without a DOM in
 * `airapp-gate.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type BusabaseAirAppAuthStatus, createAirAppConnectGate } from "./airapp-gate.js";

const jsonResponse = (body: unknown, init: { status?: number } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });

const status = (overrides: Partial<BusabaseAirAppAuthStatus>) =>
  ({
    connected: true,
    cloudBaseUrl: "https://busabase.com",
    readiness: "ready",
    action: "continue",
    ...overrides,
  }) as BusabaseAirAppAuthStatus;

const gateFor = (
  statusBody: unknown,
  extra: { onProvision?: () => Promise<unknown>; spaceResponse?: Response } = {},
) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/status")) {
      if (statusBody === null) throw new Error("connection refused");
      return jsonResponse(statusBody);
    }
    if (url.endsWith("/auth/space")) return extra.spaceResponse ?? jsonResponse({ ok: true });
    throw new Error(`unexpected fetch: ${url}`);
  });
  const gate = createAirAppConnectGate({
    appName: "Kelly CRM",
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    onProvision: extra.onProvision,
    demoHref: "?demo=1",
  });
  return { gate, fetchMock };
};

const overlay = () => document.querySelector("#busabaseAirAppGate");

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.className = "";
});

describe("pass()", () => {
  it("lets a Busabase-hosted AirApp through — there is no /auth/* to reach", async () => {
    const { gate } = gateFor(null);
    await expect(gate.pass()).resolves.toBe(true);
    expect(overlay()).toBeNull();
  });

  it("lets the app through when a non-JSON catch-all answers the status probe", async () => {
    // A hosted origin's catch-all can answer 200 with an HTML shell; taking that
    // as a status object would drive the gate off garbage.
    const fetchMock = vi.fn(
      async () =>
        new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } }),
    );
    const gate = createAirAppConnectGate({
      appName: "Kelly CRM",
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    await expect(gate.pass()).resolves.toBe(true);
    expect(overlay()).toBeNull();
  });

  it("passes and leaves no overlay when the gateway reports ready", async () => {
    const { gate } = gateFor(status({ readiness: "ready" }));
    await expect(gate.pass()).resolves.toBe(true);
    expect(overlay()).toBeNull();
    expect(document.documentElement.classList.contains("bb-gate-active")).toBe(false);
  });

  it("blocks and shows the connect screen when no credential is registered", async () => {
    const { gate } = gateFor(status({ connected: false, readiness: "needs_connection" }));
    await expect(gate.pass()).resolves.toBe(false);
    expect(overlay()?.querySelector("[data-connect-form]")).not.toBeNull();
    expect(document.documentElement.classList.contains("bb-gate-active")).toBe(true);
  });

  it("blocks and shows the Space screen when a Space must be chosen", async () => {
    const { gate } = gateFor(
      status({
        readiness: "needs_space",
        baseUrl: "https://busabase.com",
        spaces: [{ id: "spc_1", name: "Acme" }],
      }),
    );
    await expect(gate.pass()).resolves.toBe(false);
    expect(overlay()?.querySelectorAll("option")).toHaveLength(1);
  });
});

describe("connect screen wiring", () => {
  const showConnect = async () => {
    const { gate } = gateFor(status({ connected: false, readiness: "needs_connection" }));
    await gate.pass();
    const form = overlay()?.querySelector("form") as HTMLFormElement;
    return { form };
  };

  it("keeps the custom URL field hidden until 'Custom server' is chosen", async () => {
    const { form } = await showConnect();
    const field = form.querySelector("[data-custom-url]") as HTMLElement;
    expect(field.hidden).toBe(true);

    const custom = form.querySelector('input[value="custom"]') as HTMLInputElement;
    custom.checked = true;
    custom.dispatchEvent(new Event("change"));
    expect(field.hidden).toBe(false);
    expect((field.querySelector("input") as HTMLInputElement).required).toBe(true);
  });

  it("submits the cloud URL by default and the typed URL after switching", async () => {
    const { form } = await showConnect();
    const hidden = form.querySelector('input[name="base_url"]') as HTMLInputElement;
    expect(hidden.value).toBe("https://busabase.com");

    const custom = form.querySelector('input[value="custom"]') as HTMLInputElement;
    custom.checked = true;
    custom.dispatchEvent(new Event("change"));
    const urlInput = form.querySelector('input[name="custom_base_url"]') as HTMLInputElement;
    urlInput.value = "https://busabase.internal";
    urlInput.dispatchEvent(new Event("input"));
    expect(hidden.value).toBe("https://busabase.internal");
  });

  it("restores the cloud URL when the operator switches back", async () => {
    const { form } = await showConnect();
    const hidden = form.querySelector('input[name="base_url"]') as HTMLInputElement;
    const custom = form.querySelector('input[value="custom"]') as HTMLInputElement;
    const cloud = form.querySelector('input[value="cloud"]') as HTMLInputElement;

    custom.checked = true;
    custom.dispatchEvent(new Event("change"));
    (form.querySelector('input[name="custom_base_url"]') as HTMLInputElement).value =
      "https://x.test";
    form.querySelector('input[name="custom_base_url"]')?.dispatchEvent(new Event("input"));
    expect(hidden.value).toBe("https://x.test");

    cloud.checked = true;
    custom.checked = false;
    cloud.dispatchEvent(new Event("change"));
    // Leaving a stale custom URL here would silently POST the wrong server.
    expect(hidden.value).toBe("https://busabase.com");
  });
});

describe("Space screen wiring", () => {
  const showSpace = async (extra: { spaceResponse?: Response } = {}) => {
    const onReady = vi.fn();
    const { gate, fetchMock } = gateFor(
      status({
        readiness: "needs_space",
        baseUrl: "https://busabase.com",
        spaces: [{ id: "spc_1", name: "Acme" }],
      }),
      extra,
    );
    await gate.pass({ onReady });
    const form = overlay()?.querySelector("[data-space-form]") as HTMLFormElement;
    return { form, onReady, fetchMock, gate };
  };

  it("POSTs the chosen Space then hands control back to the app", async () => {
    const { form, onReady, fetchMock } = await showSpace();
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/auth/space"));
    expect(call?.[1]).toMatchObject({ method: "POST" });
    expect(String(call?.[1]?.body)).toContain("space_id=spc_1");
    // The gate must come down; leaving it up would cover the app it just unlocked.
    expect(overlay()).toBeNull();
  });

  it("surfaces the server's rejection and lets the operator try again", async () => {
    const { form, onReady } = await showSpace({
      spaceResponse: jsonResponse({ error: "That Space is not yours." }, { status: 400 }),
    });
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    const error = form.querySelector("[data-space-error]") as HTMLElement;
    await vi.waitFor(() => expect(error.hidden).toBe(false));
    expect(error.textContent).toBe("That Space is not yours.");
    expect(onReady).not.toHaveBeenCalled();
    expect((form.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("renderSetupRequired()", () => {
  it("provisions on click, then hands control back", async () => {
    const onProvision = vi.fn(async () => undefined);
    const onRetry = vi.fn();
    const { gate } = gateFor(status({ readiness: "ready" }), { onProvision });
    gate.renderSetupRequired("SETUP_REQUIRED: contacts", onRetry);

    const button = overlay()?.querySelector("[data-provision]") as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    expect(onProvision).toHaveBeenCalledTimes(1);
  });

  it("re-renders into the new state when provisioning ends up awaiting approval", async () => {
    // The button must not just show an error line: a submitted-but-pending
    // change owes the operator "Check again", not "Initialize" a second time.
    const onProvision = vi.fn(async () => {
      throw new Error("SETUP_PENDING: cr-9 awaits approval");
    });
    const { gate } = gateFor(status({ readiness: "ready" }), { onProvision });
    gate.renderSetupRequired("SETUP_REQUIRED: contacts", vi.fn());

    (overlay()?.querySelector("[data-provision]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(overlay()?.querySelector("[data-retry]")).not.toBeNull());
    expect(overlay()?.querySelector("[data-provision]")).toBeNull();
    expect(overlay()?.textContent).toContain("cr-9 awaits approval");
  });

  it("retries on click", async () => {
    const onRetry = vi.fn();
    const { gate } = gateFor(status({ readiness: "ready" }));
    gate.renderSetupRequired("SETUP_PENDING: cr-1", onRetry);
    (overlay()?.querySelector("[data-retry]") as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("close()", () => {
  it("removes the overlay and gives scrolling back to the page", async () => {
    const { gate } = gateFor(status({ connected: false, readiness: "needs_connection" }));
    await gate.pass();
    expect(overlay()).not.toBeNull();

    gate.close();
    expect(overlay()).toBeNull();
    expect(document.documentElement.classList.contains("bb-gate-active")).toBe(false);
  });
});

describe("mount option", () => {
  it("renders into a supplied element instead of creating its own", async () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const gate = createAirAppConnectGate({
      appName: "Kelly CRM",
      mount: "#host",
      fetch: (async () =>
        jsonResponse(
          status({ connected: false, readiness: "needs_connection" }),
        )) as unknown as typeof globalThis.fetch,
    });
    await gate.pass();
    expect(document.querySelector("#host [data-connect-form]")).not.toBeNull();
    expect(overlay()).toBeNull();
  });
});

describe("shouldGate", () => {
  it("skips the gate entirely — and never probes — when the host says it is hosted", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(status({ readiness: "needs_connection" })));
    const gate = createAirAppConnectGate({
      appName: "Kelly CRM",
      shouldGate: () => false,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    await expect(gate.pass()).resolves.toBe(true);
    expect(overlay()).toBeNull();
    // Probing anyway would gate a hosted AirApp whose server happens to answer.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("awaits an async predicate", async () => {
    const gate = createAirAppConnectGate({
      appName: "Kelly CRM",
      shouldGate: async () => false,
      fetch: (async () => {
        throw new Error("should not be called");
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(gate.pass()).resolves.toBe(true);
  });

  it("still gates when the predicate says so", async () => {
    const { gate } = gateFor(status({ connected: false, readiness: "needs_connection" }));
    await expect(gate.pass()).resolves.toBe(false);
    expect(overlay()?.querySelector("[data-connect-form]")).not.toBeNull();
  });
});
