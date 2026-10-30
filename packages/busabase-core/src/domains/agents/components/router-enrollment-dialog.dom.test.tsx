// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterEnrollmentDialog } from "./router-enrollment-dialog";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(
  options: {
    expired?: boolean;
    online?: boolean;
    activationFails?: boolean;
    command?: string;
    grants?: { grantId: string; spaceName: string }[];
  } = {},
) {
  const mint = vi.fn(async () => ({
    enrollmentId: "enrollment-1",
    command: options.command ?? "[test pairing command]",
    expiresAt: new Date(Date.now() + (options.expired ? -1000 : 600_000)).toISOString(),
  }));
  const cancel = vi.fn(async () => ({ ok: true }));
  const complete = options.activationFails
    ? vi.fn(async () => {
        throw new Error("activation unavailable");
      })
    : vi.fn(async () => ({ connectionSlug: "acprouter:device-1", agentSlug: "claude-acp" }));
  const session = vi.fn(async () => ({ slug: "acprouter:device-1" }));
  const query = (key: string, value: unknown) => ({
    queryOptions: () => ({ queryKey: [key], queryFn: async () => value }),
    queryKey: () => [key],
  });
  const mutation = (fn: unknown) => ({ mutationOptions: () => ({ mutationFn: fn }) });
  const loadGrants = vi.fn(
    async () => options.grants ?? [{ grantId: "grant-1", spaceName: "My Router workspace" }],
  );
  const orpc = {
    agents: {
      routerEnrollment: {
        grants: { queryOptions: () => ({ queryKey: ["grants"], queryFn: loadGrants }) },
        status: query("status", {
          state: options.online ? "online" : "not_redeemed",
          machineId: "enrollment-1",
        }),
        mint: mutation(mint),
        cancel: mutation(cancel),
        complete: mutation(complete),
      },
      catalog: query("catalog", []),
      connections: { list: query("connections", []) },
      sessions: { create: mutation(session) },
    },
  } as unknown as BusabaseQueryUtils;
  const onConnected = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <RouterEnrollmentDialog orpc={orpc} spaceId="space-1" onConnected={onConnected} />
    </QueryClientProvider>,
  );
  return { mint, cancel, complete, session, onConnected, loadGrants, ...rendered };
}

async function openAndMint() {
  fireEvent.click(screen.getByRole("button", { name: "Connect via ACPRouter" }));
  await screen.findByText("Router workspace authorized.");
  fireEvent.click(screen.getByRole("button", { name: "Generate pairing command" }));
}

describe("Router pairing dialog (mock RPC component checks)", () => {
  it("separates authorization from readiness and warns about shell exposure before copying", async () => {
    const { mint, session } = setup();
    await openAndMint();
    await screen.findByText("[test pairing command]");
    expect(screen.getByText(/local shell history and process listings/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start conversation" })).toBeNull();
    expect(session).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("busabase-router-pairing:space-1")).not.toContain(
      "[test pairing command]",
    );
    expect(mint).toHaveBeenCalledWith(
      { grantId: "grant-1", agentSlug: "claude-acp" },
      expect.anything(),
    );
  });

  it("hides expired commands and requires cancellation before regenerating", async () => {
    const { cancel } = setup({ expired: true });
    await openAndMint();
    await screen.findByText(/Command expired/);
    expect(screen.queryByText("[test pairing command]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel pairing / generate another" }));
    await waitFor(() => expect(cancel).toHaveBeenCalled());
    await screen.findByRole("button", { name: "Generate pairing command" });
  });

  it("starts a session only after confirmed completion", async () => {
    const { session, onConnected } = setup({ online: true });
    await openAndMint();
    fireEvent.click(await screen.findByRole("button", { name: "Finish pairing" }));
    await screen.findByText("Agent ready. You can start a conversation.");
    expect(session).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start conversation" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acprouter:device-1"));
  });

  it("retains pairing and offers completion retry after activation failure", async () => {
    setup({ online: true, activationFails: true });
    await openAndMint();
    fireEvent.click(await screen.findByRole("button", { name: "Finish pairing" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Start conversation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Finish pairing" })).toBeTruthy();
  });

  it("restores nonsecret pairing metadata after reload without restoring a command", async () => {
    window.sessionStorage.setItem(
      "busabase-router-pairing:space-1",
      JSON.stringify({
        grantId: "grant-1",
        agentSlug: "claude-acp",
        enrollmentId: "enrollment-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    setup({ online: true });
    fireEvent.click(screen.getByRole("button", { name: "Connect via ACPRouter" }));
    await screen.findByText(/Pairing restored/);
    expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Finish pairing" })).toBeTruthy();
  });

  it("reports blocked OAuth popups with a recovery action", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Connect via ACPRouter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Authorize Router workspace" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Allow pop-ups, then try authorization again.",
    );
  });

  it("returns keyboard focus to the trigger after Escape", async () => {
    setup();
    const trigger = screen.getByRole("button", { name: "Connect via ACPRouter" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("copies once and clears copied feedback after two seconds", async () => {
    const command =
      "npx @acprouter/cli connect --server http://127.0.0.1:15421 --token acp_test_token_for_component_check";
    const writeText = vi.fn(async () => {});
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), { clipboard: { writeText } }),
    );
    setup({ command });
    await openAndMint();
    fireEvent.click(await screen.findByRole("button", { name: "Copy command" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(command);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy(), {
      timeout: 3000,
    });
  });
});

describe("Router authorization attempts", () => {
  function popupWindow() {
    return { closed: false, close: vi.fn() } as unknown as Window;
  }

  async function authorize(popup = popupWindow(), options: Parameters<typeof setup>[0] = {}) {
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    const view = setup(options);
    fireEvent.click(screen.getByRole("button", { name: "Connect via ACPRouter" }));
    const button = await screen.findByRole("button", { name: "Authorize Router workspace" });
    fireEvent.click(button);
    const url = new URL(String(open.mock.calls[0]?.[0]));
    const flowId = url.searchParams.get("flowId");
    const send = (data: object, overrides: { origin?: string; source?: Window } = {}) => {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: overrides.origin ?? url.origin,
            source: overrides.source ?? popup,
            data: { flowId, ...data },
          }),
        );
      });
    };
    return { ...view, popup, open, url, flowId, button, send };
  }

  it("starts at the configured main origin and binds the workspace return origin", async () => {
    vi.stubGlobal("__SHARELIB_PUBLIC_ENV__", { appUrl: "https://busabase.com/some/path" });
    const { url, open, flowId } = await authorize();
    expect(url.origin).toBe("https://busabase.com");
    expect(url.pathname).toBe("/api/agents/acprouter/oauth/start");
    expect(url.searchParams.get("returnOrigin")).toBe(window.location.origin);
    expect(url.searchParams.get("spaceId")).toBe("space-1");
    expect(flowId).toMatch(/^[a-f0-9-]{36}$/);
    expect(open.mock.calls[0]?.[1]).toBe(`busabase-router-oauth-${flowId}`);
    const button = screen.getByRole("button", { name: "Authorize Router workspace" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("falls back to this deployment's origin for invalid public configuration", async () => {
    vi.stubGlobal("__SHARELIB_PUBLIC_ENV__", { appUrl: "javascript:alert(1)" });
    const { url } = await authorize();
    expect(url.origin).toBe(window.location.origin);
  });

  it("rejects spoofed origin, source and flow, then consumes one matching success", async () => {
    vi.stubGlobal("__SHARELIB_PUBLIC_ENV__", { appUrl: "https://busabase.com" });
    const { send, mint, loadGrants } = await authorize();
    const success = { type: "busabase:router-authorized", grantId: "grant-authorized" };
    send(success, { origin: window.location.origin });
    send(success, { source: popupWindow() });
    send({ ...success, flowId: "wrong-flow" });
    expect(screen.getByText("Complete Router authorization in the new window…")).toBeTruthy();
    expect(loadGrants).toHaveBeenCalledTimes(1);
    send(success);
    await waitFor(() => expect(loadGrants).toHaveBeenCalledTimes(2));
    send({ type: "busabase:router-error", reason: "access_denied" });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generate pairing command" }));
    await waitFor(() =>
      expect(mint).toHaveBeenCalledWith(
        { grantId: "grant-authorized", agentSlug: "claude-acp" },
        expect.anything(),
      ),
    );
  });

  it("reports decline, supports a fresh attempt and ignores the previous attempt", async () => {
    const { send, open, url, flowId } = await authorize();
    send({ type: "busabase:router-error", reason: "access_denied", message: "untrusted text" });
    expect(screen.getByRole("alert").textContent).toBe(
      "Router authorization was declined. Try again when ready.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Authorize Router workspace" }));
    expect(open).toHaveBeenCalledTimes(2);
    const nextUrl = new URL(String(open.mock.calls[1]?.[0]));
    expect(nextUrl.searchParams.get("flowId")).not.toBe(flowId);
    expect(nextUrl.origin).toBe(url.origin);
    expect(open.mock.calls[1]?.[1]).not.toBe(open.mock.calls[0]?.[1]);
    send({ type: "busabase:router-authorized", grantId: "old-grant" });
    expect(screen.getByText("Complete Router authorization in the new window…")).toBeTruthy();
  });

  it.each([
    ["expired", "Router authorization expired or could not be verified. Try again."],
    ["session_expired", "Your session expired. Sign in again, then retry Router authorization."],
    ["forbidden", "You no longer have permission to authorize this workspace."],
    ["unavailable", "Router is temporarily unavailable. Try authorization again."],
    ["already_completed", "This Router authorization was already used. Try again."],
    ["__proto__", "Router authorization was not completed. Try again."],
  ])("reports %s with a useful recovery message", async (reason, message) => {
    const { send } = await authorize();
    send({ type: "busabase:router-error", reason });
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(
      (screen.getByRole("button", { name: "Authorize Router workspace" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("refreshes saved grants after a closed popup without waiting indefinitely", async () => {
    const popup = popupWindow();
    const { loadGrants } = await authorize(popup, { grants: [] });
    loadGrants.mockResolvedValue([{ grantId: "recovered", spaceName: "Saved authorization" }]);
    Object.defineProperty(popup, "closed", { value: true });
    expect(await screen.findByText("Router workspace authorized.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "Authorization window closed. Choose a saved workspace or try authorization again.",
    );
    expect(screen.queryByText("Complete Router authorization in the new window…")).toBeNull();
    expect(loadGrants).toHaveBeenCalledTimes(2);
  });

  it("expires a stalled popup and allows a fresh attempt", async () => {
    const { popup } = await authorize();
    const afterExpiry = Date.now() + 600_001;
    vi.spyOn(Date, "now").mockReturnValue(afterExpiry);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Router authorization expired or could not be verified. Try again.",
    );
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Complete Router authorization in the new window…")).toBeNull();
  });

  it("abandons popup messages after dialog close and closes its popup on unmount", async () => {
    const { popup, send, unmount, loadGrants } = await authorize();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(popup.close).toHaveBeenCalledTimes(1);
    send({ type: "busabase:router-authorized", grantId: "stale-grant" });
    expect(loadGrants).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Connect via ACPRouter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Authorize Router workspace" }));
    unmount();
    expect(popup.close).toHaveBeenCalledTimes(2);
  });
});
