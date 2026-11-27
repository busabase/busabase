// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppUserFieldEditor, AppUserFieldValue } from "./app-user-field";
import {
  type AppUserFieldHost,
  AppUserFieldHostProvider,
  type AppUserFieldSearchResult,
  type AppUserFieldUser,
} from "./app-user-field-slot";

afterEach(() => {
  cleanup();
});

const ann: AppUserFieldUser = {
  id: "apu_ann",
  email: "ann@shop.test",
  status: "active",
  lastSignInAt: "2026-11-14T08:00:00.000Z",
  apps: [{ id: "nod_shop", name: "Ann's Shop" }],
};
const bob: AppUserFieldUser = {
  id: "apu_bob",
  email: "bob@shop.test",
  status: "disabled",
  lastSignInAt: null,
  apps: [],
};
const field = { baseId: "bse_orders" };

function makeHost(overrides: Partial<AppUserFieldHost> = {}) {
  const known = new Map([ann, bob].map((user) => [user.id, user]));
  const host: AppUserFieldHost = {
    scope: "spc_1",
    resolve: vi.fn(async (_baseId: string, ids: string[]) =>
      ids.flatMap((id) => (known.has(id) ? [known.get(id) as AppUserFieldUser] : [])),
    ),
    search: vi.fn(async (query: string) => ({
      users: [ann, bob].filter((user) => user.email.includes(query)),
      canPick: true,
    })),
    openManage: vi.fn(),
    ...overrides,
  };
  return host;
}

function wrap(children: ReactNode, host: AppUserFieldHost | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppUserFieldHostProvider value={host}>{children}</AppUserFieldHostProvider>
    </QueryClientProvider>,
  );
}

describe("AppUserFieldValue", () => {
  it("resolves every cell on screen in ONE call and shows each state", async () => {
    const host = makeHost();
    wrap(
      <div>
        <AppUserFieldValue field={field} value="apu_ann" />
        <AppUserFieldValue field={field} value="apu_bob" />
        <AppUserFieldValue field={field} value="apu_gone" />
        <AppUserFieldValue field={field} value="" />
      </div>,
      host,
    );

    expect(await screen.findByText("ann@shop.test")).toBeTruthy();
    const disabled = await screen.findByText("bob@shop.test");
    expect(disabled.closest("[data-app-user-state]")?.getAttribute("data-app-user-state")).toBe(
      "disabled",
    );
    expect(screen.getByText("Disabled")).toBeTruthy();
    const deleted = await screen.findByText("Deleted app user");
    expect(deleted.closest("[data-app-user-id]")?.getAttribute("data-app-user-id")).toBe(
      "apu_gone",
    );
    const deletedChip = deleted.closest("[data-app-user-state]");
    expect(deletedChip?.getAttribute("data-app-user-state")).toBe("deleted");
    expect(deletedChip?.getAttribute("title")).toBe("Deleted app user");
    expect(deletedChip?.textContent).not.toContain("apu_gone");
    expect(screen.getByText("-")).toBeTruthy();

    // Batched: three ids, one request, scoped to the Base that holds them.
    expect(host.resolve).toHaveBeenCalledTimes(1);
    expect(host.resolve).toHaveBeenCalledWith("bse_orders", ["apu_ann", "apu_bob", "apu_gone"]);
  });

  it("without a host shows the raw id and says app users are a Cloud feature", () => {
    wrap(<AppUserFieldValue field={field} value="apu_ann" />, null);
    const raw = screen.getByText("apu_ann");
    expect(raw.getAttribute("data-app-user-state")).toBe("raw");
    expect(raw.className).toContain("font-mono");
    expect(raw.getAttribute("title")).toContain("App users are available on Busabase Cloud");
  });

  it("opens the details popover and links to Space settings → App users", async () => {
    const host = makeHost();
    wrap(<AppUserFieldValue field={field} value="apu_ann" />, host);
    fireEvent.click(await screen.findByRole("button", { name: "App user details: ann@shop.test" }));

    const details = await screen.findByText("Last sign-in");
    const panel = details.closest("[data-app-user-details]") as HTMLElement;
    expect(within(panel).getByText("Active")).toBeTruthy();
    expect(within(panel).getByText("apu_ann")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Ann's Shop" }));
    expect(host.openManage).toHaveBeenLastCalledWith({ appId: "nod_shop" });

    fireEvent.click(await screen.findByRole("button", { name: "App user details: ann@shop.test" }));
    fireEvent.click(await screen.findByRole("button", { name: "Manage app users" }));
    expect(host.openManage).toHaveBeenLastCalledWith(undefined);
  });
});

function EditorHarness({
  initial,
  focusOnMount = false,
}: {
  initial: string | null;
  focusOnMount?: boolean;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <>
      <AppUserFieldEditor
        field={field}
        focusOnMount={focusOnMount}
        fieldName="Buyer"
        inputId="buyer"
        onChange={setValue}
        value={value}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}
const currentValue = () => screen.getByTestId("value").textContent;

describe("AppUserFieldEditor", () => {
  it("focuses Clear for a grid viewer who cannot use the picker", async () => {
    const host = makeHost({ search: vi.fn(async () => ({ users: [], canPick: false })) });
    wrap(<EditorHarness initial="apu_ann" focusOnMount />, host);
    await screen.findByText(/Only space owners and admins can pick an app user/);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Clear" }));
  });

  it("focuses the grid editor itself when there is no search or value to clear", async () => {
    const host = makeHost({ search: vi.fn(async () => ({ users: [], canPick: false })) });
    const { container } = wrap(<EditorHarness initial={null} focusOnMount />, host);
    await screen.findByText(/Only space owners and admins can pick an app user/);
    expect(document.activeElement).toBe(container.querySelector("[data-app-user-editor]"));
  });

  it("removes old options immediately while the next email search is debounced or loading", async () => {
    let finishSearch:
      | ((result: { users: AppUserFieldUser[]; canPick: boolean }) => void)
      | undefined;
    const host = makeHost({
      search: vi.fn((query: string) =>
        query
          ? new Promise<AppUserFieldSearchResult>((resolve) => {
              finishSearch = resolve;
            })
          : Promise.resolve({ users: [ann, bob], canPick: true }),
      ),
    });
    wrap(<EditorHarness initial={null} />, host);
    const search = await screen.findByRole("searchbox");
    expect(await screen.findByRole("option", { name: "Choose ann@shop.test" })).toBeTruthy();

    fireEvent.change(search, { target: { value: "bob" } });
    // Even before the 250ms debounce elapses, the grid's Enter handler must
    // have no stale option it could click on the user's behalf.
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByRole("listbox").getAttribute("aria-busy")).toBe("true");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(currentValue()).toBe("null");
    await waitFor(() => expect(host.search).toHaveBeenLastCalledWith("bob"));
    expect(screen.queryByRole("option")).toBeNull();
    finishSearch?.({ users: [bob], canPick: true });
    fireEvent.click(await screen.findByRole("option", { name: "Choose bob@shop.test" }));
    expect(currentValue()).toBe('"apu_bob"');
  });

  it("shows a search failure with no previously available candidates", async () => {
    const host = makeHost({
      search: vi.fn(async (query: string) => {
        if (query) throw new Error("Search unavailable");
        return { users: [ann], canPick: true };
      }),
    });
    wrap(<EditorHarness initial={null} />, host);
    const search = await screen.findByRole("searchbox");
    expect(await screen.findByRole("option", { name: "Choose ann@shop.test" })).toBeTruthy();
    fireEvent.change(search, { target: { value: "bob" } });
    expect((await screen.findByRole("alert")).textContent).toContain("load");
    expect(screen.queryByRole("option")).toBeNull();
    expect(currentValue()).toBe("null");
  });

  it("searches by email and picks a person; Clear empties the cell", async () => {
    const host = makeHost();
    wrap(<EditorHarness initial={null} />, host);

    const search = await screen.findByRole("searchbox", {
      name: "Buyer: Search app users by email",
    });
    fireEvent.change(search, { target: { value: "bob" } });
    await waitFor(() => expect(host.search).toHaveBeenLastCalledWith("bob"));
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: "Choose ann@shop.test" })).toBeNull(),
    );

    fireEvent.click(await screen.findByRole("option", { name: "Choose bob@shop.test" }));
    expect(currentValue()).toBe('"apu_bob"');
    // The picked person shows at once — no second lookup for what the picker knew.
    expect(
      await screen.findByRole("button", { name: "App user details: bob@shop.test" }),
    ).toBeTruthy();
    expect(host.resolve).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(currentValue()).toBe("null");
  });

  it("someone who may not list app users can keep or clear, not pick, and is told why", async () => {
    const host = makeHost({ search: vi.fn(async () => ({ users: [], canPick: false })) });
    wrap(<EditorHarness initial="apu_ann" />, host);

    expect(
      await screen.findByText(/Only space owners and admins can pick an app user/),
    ).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(await screen.findByText("ann@shop.test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(currentValue()).toBe("null");
  });

  it("without a host is a plain id input", () => {
    wrap(<EditorHarness initial="apu_ann" />, null);
    const input = screen.getByRole("textbox", { name: "Buyer" }) as HTMLInputElement;
    expect(input.value).toBe("apu_ann");
    fireEvent.change(input, { target: { value: "apu_new" } });
    expect(currentValue()).toBe('"apu_new"');
  });
});
