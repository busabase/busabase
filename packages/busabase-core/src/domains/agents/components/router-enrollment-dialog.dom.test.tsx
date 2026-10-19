// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const orpc = {
    agents: {
      routerEnrollment: {
        grants: query("grants", [{ grantId: "grant-1", spaceName: "My Router workspace" }]),
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
  render(
    <QueryClientProvider client={client}>
      <RouterEnrollmentDialog orpc={orpc} spaceId="space-1" onConnected={onConnected} />
    </QueryClientProvider>,
  );
  return { mint, cancel, complete, session, onConnected };
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
